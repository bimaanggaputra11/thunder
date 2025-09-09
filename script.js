// Supabase Configuration
const SUPABASE_URL = 'https://bewuevhfiehsjofvwpbi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJld3VldmhmaWVoc2pvZnZ3cGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxNjA1MDEsImV4cCI6MjA3MjczNjUwMX0.o7KJ4gkbfZKYy3lvuV63yGM5XCnk5xk4vCLv46hNAII';


const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Configuration
const TOKEN_MINT = "ACbRrERR5GJnADhLhhanxrDCXJzGhyF64SKihbzBpump";
const WHEEL_SLOTS = 50; // Number of slots in the wheel
const SPIN_INTERVAL = 30 * 60; 


let wheelSlots = Array(WHEEL_SLOTS).fill(null);
let waitingQueue = [];
let recentWinners = []; 
let currentUser = null;
let countdownTimer = SPIN_INTERVAL;
let spinInterval = null;
let wheelRotation = 0;
let lastSpinTimestamp = null;
let isSpinning = false; 
let realTimeSubscription = null; 
let gameInitialized = false; 
let countdownInterval = null; 


let currentSpinId = null; 
let targetWinnerSlot = null; 
let spinStartTime = null; 


if (!supabase) {
  console.error('❌ Supabase client could not be initialized. Make sure the Supabase library is loaded.');
}

// ==================== UTILITY FUNCTIONS ====================
function showLoading(element) {
  if (element && element.classList) {
    element.classList.add('loading');
  }
}

function hideLoading(element) {
  if (element && element.classList) {
    element.classList.remove('loading');
  }
}

function disableButton(button, text = 'Loading...') {
  if (button) {
    button.disabled = true;
    button.originalText = button.textContent;
    button.textContent = text;
  }
}

function enableButton(button) {
  if (button) {
    button.disabled = false;
    button.textContent = button.originalText || 'Verify';
  }
}

function formatAddress(address) {
  if (!address) return '';
  return `${address.slice(0, 4)}...${address.slice(-3)}`;
}

function showMessage(text, type) {
  const msg = document.getElementById('message');
  if (msg) {
    msg.innerHTML = '';
    
    setTimeout(() => {
      msg.innerHTML = `<div class="message ${type}-message">${text}</div>`;
    }, 50);
    
    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        const currentMessage = msg.querySelector('.message');
        if (currentMessage) {
          currentMessage.style.opacity = '0';
          currentMessage.style.transform = 'translateY(-10px)';
          setTimeout(() => {
            msg.innerHTML = '';
          }, 300);
        }
      }, 5000);
    }
  }
}

function animateNumber(element, from, to) {
  if (from === to) return;
  
  const duration = 3000;
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    const easeOutQuart = 1 - Math.pow(1 - progress, 4);
    const current = Math.round(from + (to - from) * easeOutQuart);
    
    element.textContent = current;
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}


function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// ==================== AUTO FILL EMPTY SLOTS ====================

function fillEmptySlots() {
  let slotsUpdated = false;
  
  for (let i = 0; i < wheelSlots.length; i++) {
    if (wheelSlots[i] === null) {
      
      const availableUsers = waitingQueue.filter(addr => 
        !recentWinners.includes(addr) && !wheelSlots.includes(addr)
      );
      
      if (availableUsers.length > 0) {
        const nextUser = availableUsers[0];
        wheelSlots[i] = nextUser;
        waitingQueue = waitingQueue.filter(addr => addr !== nextUser);
        slotsUpdated = true;
        console.log(`🔄 Filled slot ${i} with ${formatAddress(nextUser)} from queue`);
      }
    }
  }
  
  return slotsUpdated;
}

// ==================== SPIN LOCK FUNCTIONS ====================
async function initializeSpinLock() {
  if (!supabase) {
    console.warn('⚠️ Supabase is not available, uses local spin lock');
    return;
  }

  try {
    // Initialize spin lock in database if not exists
    const { data: existing } = await supabase
      .from('settings')
      .select('*')
      .eq('key', 'spin_lock')
      .maybeSingle();

    if (!existing) {
      await supabase.from('settings').insert({
        key: 'spin_lock',
        value: 'false'
      });
    }

    
    await initializeSpinStateTable();

    console.log('✅ Spin lock initialized');
  } catch (error) {
    console.error('❌ Failed to initialize spin lock:', error);
  }
}


async function initializeSpinStateTable() {
  if (!supabase) return;

  try {
    
    const { data: existing } = await supabase
      .from('spin_state')
      .select('*')
      .maybeSingle();

    if (!existing) {
      
      await supabase.from('spin_state').insert({
        id: 1,
        spin_id: null,
        winner_slot: null,
        winner_address: null,
        target_rotation: 0,
        spin_duration: 4000,
        spin_start_time: null,
        is_active: false,
        participants_snapshot: '[]',
        random_seed: null
      });
    }

    console.log('✅ Spin state table initialized');
  } catch (error) {
    console.error('❌ Failed to initialize spin state table:', error);
  }
}

async function acquireSpinLock() {
  if (!supabase) return true; 

  try {
    const { data, error } = await supabase
      .from('settings')
      .update({ value: 'true' })
      .eq('key', 'spin_lock')
      .eq('value', 'false') 
      .select();

    return !error && data && data.length > 0;
  } catch (error) {
    console.error('❌ Failed to acquire spin lock:', error);
    return false;
  }
}

async function releaseSpinLock() {
  if (!supabase) return;

  try {
    await supabase
      .from('settings')
      .update({ value: 'false' })
      .eq('key', 'spin_lock');
  } catch (error) {
    console.error('❌ Failed to release spin lock:', error);
  }
}

// ==================== FALLBACK SPIN FUNCTIONS ====================

function fallbackSpinAnimation(targetRotation, duration, onComplete) {
  console.log('⚠️ Using fallback animation (GSAP not available)');
  
  const startTime = performance.now();
  const startRotation = wheelRotation;
  
  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing function (cubic-bezier approximation)
    const easeOutCubic = 1 - Math.pow(1 - progress, 3);
    
    wheelRotation = startRotation + targetRotation * easeOutCubic;
    initializeWheel();
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      onComplete();
    }
  }
  
  requestAnimationFrame(animate);
}

// ==================== SYNCHRONIZED SPIN FUNCTIONS ====================

async function determineWinnerOnServer() {
  
  if (!supabase) {
    return determineWinnerLocally();
  }

  try {
    
    const filledSlots = wheelSlots.map((slot, index) => slot !== null ? { address: slot, slotIndex: index } : null)
                                  .filter(Boolean);

    if (filledSlots.length === 0) {
      console.log('⚠️ No participants to determine winner from');
      return null;
    }

    
    const currentTimeSecond = Math.floor(Date.now() / 1000);
    const randomSeed = currentTimeSecond; 
    
    
    const seededRandomValue = seededRandom(randomSeed);
    const winnerIndex = Math.floor(seededRandomValue * filledSlots.length);
    const winnerSlot = filledSlots[winnerIndex].slotIndex;
    const winnerAddress = filledSlots[winnerIndex].address;

    
    const spinSeed1 = seededRandom(randomSeed + 1);
    const spinSeed2 = seededRandom(randomSeed + 2);
    const spinSeed3 = seededRandom(randomSeed + 3);

    
    const anglePerSlot = (2 * Math.PI) / WHEEL_SLOTS;
    const targetAngle = winnerSlot * anglePerSlot;
    
    
    const minSpins = 4;
    const maxSpins = 6;
    const totalSpins = minSpins + spinSeed1 * (maxSpins - minSpins);
    const targetRotation = totalSpins * 2 * Math.PI + (2 * Math.PI - targetAngle);

    
    const spinDuration = 3000 + spinSeed2 * 2000; 
    
    const spinId = `spin_${randomSeed}_${currentTimeSecond}`;
    const spinStartTime = Date.now();

    
    const { error } = await supabase
      .from('spin_state')
      .update({
        spin_id: spinId,
        winner_slot: winnerSlot,
        winner_address: winnerAddress,
        target_rotation: targetRotation,
        spin_duration: spinDuration,
        spin_start_time: spinStartTime,
        is_active: true,
        participants_snapshot: JSON.stringify(filledSlots),
        random_seed: randomSeed
      })
      .eq('id', 1);

    if (error) throw error;

    console.log('🎯 Winner determined on server (deterministic):', {
      spinId,
      randomSeed,
      winnerSlot,
      winnerAddress: formatAddress(winnerAddress),
      targetRotation: (targetRotation * 180 / Math.PI).toFixed(1) + '°',
      spinDuration: (spinDuration / 1000).toFixed(1) + 's',
      seededRandomValue: seededRandomValue.toFixed(4)
    });

    return {
      spinId,
      winnerSlot,
      winnerAddress,
      targetRotation,
      spinDuration,
      spinStartTime,
      randomSeed
    };
  } catch (error) {
    console.error('❌ Failed to determine winner on server:', error);
    return determineWinnerLocally(); 
  }
}


function determineWinnerLocally() {
  const filledSlots = wheelSlots.map((slot, index) => slot !== null ? { address: slot, slotIndex: index } : null)
                                .filter(Boolean);

  if (filledSlots.length === 0) {
    console.log('⚠️ No participants to determine winner from');
    return null;
  }

  
  const currentTimeSecond = Math.floor(Date.now() / 1000);
  const randomSeed = currentTimeSecond;
  
  const seededRandomValue = seededRandom(randomSeed);
  const winnerIndex = Math.floor(seededRandomValue * filledSlots.length);
  const winnerSlot = filledSlots[winnerIndex].slotIndex;
  const winnerAddress = filledSlots[winnerIndex].address;

  const spinSeed1 = seededRandom(randomSeed + 1);
  const spinSeed2 = seededRandom(randomSeed + 2);

  const anglePerSlot = (2 * Math.PI) / WHEEL_SLOTS;
  const targetAngle = winnerSlot * anglePerSlot;
  
  const minSpins = 4;
  const maxSpins = 6;
  const totalSpins = minSpins + spinSeed1 * (maxSpins - minSpins);
  const targetRotation = totalSpins * 2 * Math.PI + (2 * Math.PI - targetAngle);

  const spinDuration = 3000 + spinSeed2 * 2000;
  const spinStartTime = Date.now();
  const spinId = `local_spin_${randomSeed}_${currentTimeSecond}`;

  console.log('🎯 Winner determined locally (deterministic):', {
    spinId,
    randomSeed,
    winnerSlot,
    winnerAddress: formatAddress(winnerAddress),
    targetRotation: (targetRotation * 180 / Math.PI).toFixed(1) + '°',
    spinDuration: (spinDuration / 1000).toFixed(1) + 's',
    seededRandomValue: seededRandomValue.toFixed(4)
  });

  return {
    spinId,
    winnerSlot,
    winnerAddress,
    targetRotation,
    spinDuration,
    spinStartTime,
    randomSeed
  };
}


async function getSpinResultFromServer() {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('spin_state')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error) throw error;

    if (data && data.is_active) {
      return {
        spinId: data.spin_id,
        winnerSlot: data.winner_slot,
        winnerAddress: data.winner_address,
        targetRotation: data.target_rotation,
        spinDuration: data.spin_duration,
        spinStartTime: data.spin_start_time,
        participantsSnapshot: JSON.parse(data.participants_snapshot || '[]'),
        randomSeed: data.random_seed
      };
    }

    return null;
  } catch (error) {
    console.error('❌ Failed to get spin result from server:', error);
    return null;
  }
}


async function markSpinCompleted() {
  if (!supabase) return;

  try {
    await supabase
      .from('spin_state')
      .update({
        is_active: false,
        spin_id: null,
        winner_slot: null,
        winner_address: null,
        target_rotation: 0,
        spin_start_time: null,
        random_seed: null
      })
      .eq('id', 1);

    console.log('✅ Spin marked as completed');
  } catch (error) {
    console.error('❌ Failed to mark spin completed:', error);
  }
}

// ==================== REAL-TIME SYNC FUNCTIONS ====================
async function setupRealTimeSync() {
  if (!supabase) {
    console.warn('⚠️Supabase not available, real-time sync disabled');
    return;
  }

  try {
    
    realTimeSubscription = supabase
      .channel('game_updates')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'wheel_slots' },
        handleRealTimeUpdate
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'queue_list' },
        handleRealTimeUpdate
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'winners_list' },
        handleRealTimeUpdate
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'settings' },
        handleRealTimeUpdate
      )
     
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'spin_state' },
        handleSpinStateUpdate
      )
      .subscribe();

    console.log('✅ Real-time sync enabled');
  } catch (error) {
    console.error('❌ Failed to setup real-time sync:', error);
  }
}

async function handleRealTimeUpdate(payload) {
  console.log('📡 Real-time update received:', payload);
  
  clearTimeout(handleRealTimeUpdate.timeout);
  handleRealTimeUpdate.timeout = setTimeout(async () => {
    await loadGameState();
    
    
    const slotsUpdated = fillEmptySlots();
    if (slotsUpdated) {
      await saveGameState();
    }
    
    updateDisplay();
  }, 1000);
}


async function handleSpinStateUpdate(payload) {
  console.log('🎪 Spin state update received:', payload);
  
  if (payload.eventType === 'UPDATE' && payload.new.is_active && !isSpinning) {
    
    const spinResult = await getSpinResultFromServer();
    if (spinResult) {
      console.log('🔄 Syncing to ongoing spin from another client');
      await synchronizedSpin(spinResult);
    }
  }
}

// ==================== DATABASE FUNCTIONS ====================
async function saveGameState() {
  if (!supabase) {
    console.error('❌ Supabase client is not available');
    return;
  }

  try {
    // Save wheel slots
    for (let i = 0; i < wheelSlots.length; i++) {
      await supabase.from('wheel_slots').upsert({ 
        slot_index: i, 
        address: wheelSlots[i] 
      }, { onConflict: 'slot_index' });
    }

    // Save waiting queue
    await supabase.from('queue_list').delete().neq('address', '');
    const uniqueQueue = [...new Set(waitingQueue)];
    for (const addr of uniqueQueue) {
      await supabase.from('queue_list').insert({ address: addr });
    }

    // Save winners
    for (const winner of recentWinners) {
      const { data: existing } = await supabase
        .from('winners_list')
        .select('address')
        .eq('address', winner)
        .maybeSingle();

      if (!existing) {
        await supabase.from('winners_list').insert({
          address: winner,
          timestamp: new Date().toISOString()
        });
      }
    }

    if (lastSpinTimestamp) {
      await supabase.from('settings').upsert([{ 
        key: 'last_spin_timestamp', 
        value: String(lastSpinTimestamp) 
      }], { onConflict: 'key' });
    }

    const nextSpinTime = lastSpinTimestamp + (SPIN_INTERVAL * 1000);
    await supabase.from('settings').upsert([{ 
      key: 'next_spin_time', 
      value: String(nextSpinTime) 
    }], { onConflict: 'key' });

    console.log('✅ Game state saved to database');
  } catch (error) {
    console.error('❌ Failed to save game state:', error);
  }
}

async function loadGameState() {
  if (!supabase) {
    console.error('❌ Supabase client is not available');
    return;
  }

  try {
    // Load winners first
    const { data: winnersData } = await supabase
      .from('winners_list')
      .select('*')
      .order('timestamp', { ascending: true });

    const allWinners = winnersData ? winnersData.map(w => w.address) : [];
    recentWinners = [...new Set(allWinners)]; 

    // Load wheel slots (exclude winners)
    const { data: slotsData } = await supabase
      .from('wheel_slots')
      .select('*')
      .order('slot_index', { ascending: true });

    wheelSlots = Array(WHEEL_SLOTS).fill(null);
    if (slotsData) {
      for (const slot of slotsData) {
        if (slot.address && !recentWinners.includes(slot.address)) {
          wheelSlots[slot.slot_index] = slot.address;
        }
      }
    }

    // Load waiting queue (exclude winners)
    const { data: queueData } = await supabase
      .from('queue_list')
      .select('*')
      .order('id', { ascending: true });

    const allQueue = queueData ? queueData.map(q => q.address) : [];
    waitingQueue = [...new Set(allQueue.filter(addr => !recentWinners.includes(addr)))];

    // Load timestamp
    const { data: timestampData } = await supabase
      .from('settings')
      .select('*')
      .eq('key', 'last_spin_timestamp')
      .maybeSingle();

    const { data: nextSpinData } = await supabase
      .from('settings')
      .select('*')
      .eq('key', 'next_spin_time')
      .maybeSingle();

    if (timestampData?.value && nextSpinData?.value) {
      lastSpinTimestamp = parseInt(timestampData.value);
      const nextSpinTime = parseInt(nextSpinData.value);
      
      const now = Date.now();
      const remaining = nextSpinTime - now;
      
      if (remaining > 0) {
        countdownTimer = Math.floor(remaining / 1000);
      } else {
        countdownTimer = 0;
        console.log('⏰ Spin time has passed, will spin immediately');
      }
    } else {
      const now = Date.now();
      lastSpinTimestamp = now;
      countdownTimer = SPIN_INTERVAL;
      
      await supabase.from('settings').upsert([
        { key: 'last_spin_timestamp', value: String(now) },
        { key: 'next_spin_time', value: String(now + (SPIN_INTERVAL * 1000)) }
      ], { onConflict: 'key' });
    }

    
    const ongoingSpin = await getSpinResultFromServer();
    if (ongoingSpin && !isSpinning) {
      console.log('🔄 Found ongoing spin, syncing...');
      await synchronizedSpin(ongoingSpin);
    }

    console.log('✅ Game state loaded from database', {
      lastSpinTimestamp: new Date(lastSpinTimestamp).toLocaleTimeString(),
      countdownTimer: `${Math.floor(countdownTimer / 60)}:${(countdownTimer % 60).toString().padStart(2, '0')}`,
      wheelParticipants: wheelSlots.filter(Boolean).length,
      queueLength: waitingQueue.length,
      winnersCount: recentWinners.length,
      ongoingSpin: !!ongoingSpin
    });
  } catch (error) {
    console.error('❌ Failed to load game state:', error);
  }
}

async function updateSpinTimestamp() {
  if (!supabase) {
    console.error('❌ Supabase client is not available');
    return;
  }

  const now = Date.now();
  lastSpinTimestamp = now;
  const nextSpinTime = now + (SPIN_INTERVAL * 1000);
  
  try {
    await supabase.from('settings').upsert([
      { key: 'last_spin_timestamp', value: String(now) },
      { key: 'next_spin_time', value: String(nextSpinTime) }
    ], { onConflict: 'key' });
    
    console.log('⏰ Spin timestamp updated:', {
      lastSpin: new Date(now).toLocaleTimeString(),
      nextSpin: new Date(nextSpinTime).toLocaleTimeString()
    });
  } catch (error) {
    console.error('❌ Failed to update spin timestamp:', error);
  }
}

// ==================== WHEEL FUNCTIONS ====================
function initializeWheel() {
  const canvas = document.getElementById('wheelCanvas');
  if (!canvas) {
    console.error('❌ Canvas element not found');
    return;
  }

  const ctx = canvas.getContext('2d');
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = 280;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw wheel segments
  const anglePerSlot = (2 * Math.PI) / WHEEL_SLOTS;
  
  for (let i = 0; i < WHEEL_SLOTS; i++) {
    const startAngle = i * anglePerSlot + wheelRotation;
    const endAngle = (i + 1) * anglePerSlot + wheelRotation;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.lineTo(centerX, centerY);
    
    if (wheelSlots[i]) {
      ctx.fillStyle = i % 2 === 0 ? '#305b4c' : '#e8e8e8';
    } else {
      ctx.fillStyle = '#ffffff';
    }
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw text
    if (wheelSlots[i]) {
      // Draw text
const textAngle = startAngle + anglePerSlot / 1.5;
ctx.save();


ctx.translate(centerX, centerY);
ctx.rotate(textAngle); 

ctx.textAlign = 'center';
ctx.fillStyle = wheelSlots[i] ? '#c5b52a' : '#999';
ctx.font = wheelSlots[i] ? 'bold 10px Arial' : '8px Arial';


ctx.fillText(
  wheelSlots[i] ? formatAddress(wheelSlots[i]) : 'Address holder',
  radius * 0.5, 
  0
);

ctx.restore();

    } else {
      // Draw text
const textAngle = startAngle + anglePerSlot / 2;
ctx.save();


ctx.translate(centerX, centerY);
ctx.rotate(textAngle); 

ctx.textAlign = 'center';
ctx.fillStyle = wheelSlots[i] ? '#c5b52a' : '#999';
ctx.font = wheelSlots[i] ? 'bold 10px Arial' : '8px Arial';


ctx.fillText(
  wheelSlots[i] ? formatAddress(wheelSlots[i]) : 'Address holder',
  radius * 0.5, 
  0
);

ctx.restore();

    }
  }

  // Draw center circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, 20, 0, 2 * Math.PI);
  ctx.fillStyle = '#333';
  ctx.fill();

  // Draw pointer at top 
  

  // Add pointer shadow
  ctx.beginPath();
  ctx.moveTo(centerX + 2, centerY - radius - -20);
  ctx.lineTo(centerX - 17, centerY - radius - 15);
  ctx.lineTo(centerX + 17, centerY - radius - 15);
  ctx.closePath();
  ctx.fillStyle = 'transparent';
  ctx.fill();
}

// ==================== VALIDATION FUNCTIONS ====================
async function validateHolder(address) {
  try {
    const res = await fetch('https://mainnet.helius-rpc.com/?api-key=c93e5dea-5c54-48b4-bb7a-9b9aef4cc41c', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [address, { mint: TOKEN_MINT }, { encoding: 'jsonParsed' }]
      })
    });

    const data = await res.json();
    return data.result?.value?.some(acc => acc.account.data.parsed.info.tokenAmount.uiAmount > 0) || false;
  } catch (err) {
    console.error('Validation error:', err);
    return false;
  }
}

async function validateAddress() {
  const input = document.getElementById('walletAddress');
  const msg = document.getElementById('message');
  const verifyBtn = document.querySelector('.verify-btn');
  const validationCard = document.querySelector('.validation-card');
  
  if (!input || !msg) {
    console.error('❌ Element not found');
    return;
  }

  const address = input.value.trim();

  msg.innerHTML = '';

  if (!address) {
    showMessage('Please enter a wallet address', 'error');
    input.focus();
    return;
  }

  if (address.length < 32 || address.length > 44) {
    showMessage('Invalid wallet address format', 'error');
    input.focus();
    return;
  }

  if (!Array.isArray(recentWinners)) {
    console.warn('⚠️ recentWinners has not been initialized, using an empty array');
    recentWinners = [];
  }

  if (recentWinners.includes(address)) {
    showMessage('This address has already won and cannot participate again', 'error');
    return;
  }

  if (wheelSlots.includes(address) || waitingQueue.includes(address)) {
    showMessage('This address is already participating in the game', 'info');
    return;
  }

  showLoading(validationCard);
  disableButton(verifyBtn, 'Validating...');
  showMessage('Validating token holder status...', 'info');

  try {
    const isHolder = await validateHolder(address);
    
    if (isHolder) {
      currentUser = address;
      showMessage('Congratulations, you are the holder! 🎉', 'success');
      await addUserToSystem(currentUser);
      
      
      const slotsUpdated = fillEmptySlots();
      if (slotsUpdated) {
        await saveGameState();
      }
      
      updateDisplay();
      input.value = '';
    } else {
      showMessage('You are not a token holder ❌', 'error');
      input.focus();
    }
  } catch (error) {
    console.error('Validation error:', error);
    showMessage('Validation failed. Please try again.', 'error');
  } finally {
    hideLoading(validationCard);
    enableButton(verifyBtn);
  }
}

async function addUserToSystem(address) {
  if (!Array.isArray(recentWinners)) recentWinners = [];
  if (!Array.isArray(wheelSlots)) wheelSlots = Array(WHEEL_SLOTS).fill(null);
  if (!Array.isArray(waitingQueue)) waitingQueue = [];

  if (recentWinners.includes(address) || 
      wheelSlots.includes(address) || 
      waitingQueue.includes(address)) {
    return;
  }

  const emptySlot = wheelSlots.findIndex(slot => !slot);
  if (emptySlot !== -1) {
    wheelSlots[emptySlot] = address;
    console.log(`✅ Added ${formatAddress(address)} to slot ${emptySlot}`);
  } else {
    waitingQueue.push(address);
    console.log(`✅ Added ${formatAddress(address)} to waiting queue`);
  }

  await saveGameState();
}

// ==================== COUNTDOWN FUNCTIONS ====================
function startCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  console.log('⏰ Starting countdown with', countdownTimer, 'seconds remaining');

  countdownInterval = setInterval(() => {
    countdownTimer--;
    updateCountdownDisplay();

    console.log('⏰ Countdown:', countdownTimer, 'seconds remaining');

    if (countdownTimer <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      
      
      fillEmptySlots(); 
      const filledSlots = wheelSlots.filter(Boolean);
      
      if (filledSlots.length > 0 && !isSpinning) {
        console.log('⏰ Time up! Starting spin with', filledSlots.length, 'participants');
        performSpin();
      } else if (filledSlots.length === 0) {
        console.log('⚠️ No participants, resetting timer');
        countdownTimer = SPIN_INTERVAL;
        startCountdown();
      } else {
        console.log('⚠️ Already spinning, waiting...');
        countdownTimer = SPIN_INTERVAL;
        startCountdown();
      }
    }
  }, 1000);
}

function updateCountdownDisplay() {
  const timerElement = document.getElementById('countdownTimer');
  if (timerElement) {
    const minutes = Math.floor(countdownTimer / 60).toString().padStart(2, '0');
    const seconds = (countdownTimer % 60).toString().padStart(2, '0');
    timerElement.textContent = `${minutes}:${seconds}`;
  }
}

// ==================== SYNCHRONIZED SPIN FUNCTIONS ====================

async function performSpin() {
  console.log('🎪 performSpin called - isSpinning:', isSpinning);
  
  if (isSpinning) {
    console.log('⚠️ Spin already in progress, skipping');
    return;
  }

  
  const slotsUpdated = fillEmptySlots();
  if (slotsUpdated) {
    await saveGameState();
    updateDisplay();
  }

  const filledSlots = wheelSlots.filter(Boolean);
  if (filledSlots.length === 0) {
    console.log('⚠️ No participants for spinning');
    countdownTimer = SPIN_INTERVAL;
    startCountdown();
    return;
  }


  const lockAcquired = await acquireSpinLock();
  if (!lockAcquired && supabase) {
    console.log('⚠️ Could not acquire spin lock, another instance is spinning');
   
    const ongoingSpin = await getSpinResultFromServer();
    if (ongoingSpin) {
      console.log('🔄 Found ongoing spin, syncing...');
      await synchronizedSpin(ongoingSpin);
    }
    return;
  }

  isSpinning = true;
  console.log('🎪 Starting spin with', filledSlots.length, 'participants');

  try {
   
    const spinResult = await determineWinnerOnServer();
    if (!spinResult) {
      console.error('❌ Failed to determine winner on server');
      throw new Error('Failed to determine winner on server');
    }

    // Update spin timestamp
    await updateSpinTimestamp();

    
    await synchronizedSpin(spinResult);

  } catch (error) {
    console.error('❌ Error during spin:', error);
    showMessage('Spin failed. Please try again.', 'error');
    
    countdownTimer = SPIN_INTERVAL;
    startCountdown();
  } finally {
    setTimeout(async () => {
      isSpinning = false;
      await releaseSpinLock();
      console.log('🎪 Spin completed, lock released');
    }, 1000);
  }
}


async function synchronizedSpin(spinResult) {
  const { targetRotation, spinDuration, spinStartTime } = spinResult;
  
 
  const now = Date.now();
  const elapsedTime = now - spinStartTime;
  const remainingDuration = Math.max(100, spinDuration - elapsedTime);

  console.log('🎪 Synchronized spin parameters:', {
    targetRotation: (targetRotation * 180 / Math.PI).toFixed(1) + '°',
    originalDuration: spinDuration + 'ms',
    elapsedTime: elapsedTime + 'ms',
    remainingDuration: remainingDuration + 'ms',
    winnerSlot: spinResult.winnerSlot,
    winnerAddress: formatAddress(spinResult.winnerAddress),
    randomSeed: spinResult.randomSeed
  });

  // Show spinning message
  showMessage('🎪 Wheel is spinning...', 'info');

 
  const onComplete = function() {
    console.log('🎪 Synchronized spin animation completed');
    const msg = document.getElementById('message');
    if (msg && msg.innerHTML.includes('spinning')) {
      msg.innerHTML = '';
    }
    selectWinnerFromServer(spinResult);
  };

  if (typeof gsap !== 'undefined') {
   
    gsap.to({ rotation: wheelRotation }, {
      rotation: wheelRotation + targetRotation,
      duration: remainingDuration / 1000,
      ease: "power3.out",
      onUpdate: function() {
        wheelRotation = this.targets()[0].rotation;
        initializeWheel();
      },
      onComplete: onComplete
    });
  } else {
    
    fallbackSpinAnimation(targetRotation, remainingDuration, onComplete);
  }
}


async function selectWinnerFromServer(spinResult) {
  const { winnerSlot, winnerAddress } = spinResult;

  console.log('🎯 Processing server-determined winner:', {
    winnerSlot,
    winnerAddress: formatAddress(winnerAddress),
    randomSeed: spinResult.randomSeed
  });

  // Highlight winning slot
  await highlightWinningSlot(winnerSlot);

  // Add confetti effect
  if (typeof confetti !== 'undefined') {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  }

  // Update game state
  if (winnerAddress) {
    // Add to winners
    if (!recentWinners.includes(winnerAddress)) {
      recentWinners.push(winnerAddress);
    }

    // Remove from wheel
    wheelSlots[winnerSlot] = null;
    console.log(`🎯 Winner ${formatAddress(winnerAddress)} removed from slot ${winnerSlot}`);

    // Remove winner from queue if they were there
    waitingQueue = waitingQueue.filter(addr => addr !== winnerAddress);
    
    
    const slotsUpdated = fillEmptySlots();
    console.log(`🔄 Auto-filled ${slotsUpdated ? 'some' : 'no'} empty slots from queue`);

    await saveGameState();
    updateDisplay();
    
    // Winner announcement
    setTimeout(() => {
      if (confirm(`🎉 CONGRATULATIONS! 🎉\n\nWinner: ${formatAddress(winnerAddress)}\nFull Address: ${winnerAddress}\n\nClick OK to continue or Cancel to copy address`)) {
        // User clicked OK
      } else {
        // Copy to clipboard
        if (navigator.clipboard) {
          navigator.clipboard.writeText(winnerAddress).then(() => {
            showMessage('Winner address copied to clipboard! 📋', 'success');
          });
        }
      }
    }, 1500);
  }

  // Mark spin as completed in server
  await markSpinCompleted();

  // Reset countdown
  countdownTimer = SPIN_INTERVAL;
  startCountdown();
}


async function highlightWinningSlot(slotIndex) {
  const canvas = document.getElementById('wheelCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = 280;
  const anglePerSlot = (2 * Math.PI) / WHEEL_SLOTS;

  // Highlight animation
  for (let i = 0; i < 6; i++) {
    initializeWheel();
    
    if (i % 2 === 0) {
      const startAngle = slotIndex * anglePerSlot + wheelRotation;
      const endAngle = (slotIndex + 1) * anglePerSlot + wheelRotation;
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.lineTo(centerX, centerY);
      ctx.fillStyle = 'rgba(255, 215, 0, 0.7)';
      ctx.fill();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 4;
      ctx.stroke();
      
      if (wheelSlots[slotIndex]) {
        const textAngle = startAngle + anglePerSlot / 2;
        const textX = centerX + Math.cos(textAngle) * (radius * 0.7);
        const textY = centerY + Math.sin(textAngle) * (radius * 0.7);
        
        ctx.save();
        ctx.translate(textX, textY);
        ctx.rotate(textAngle + Math.PI / 2);
        ctx.fillStyle = '#333';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(formatAddress(wheelSlots[slotIndex]), 0, 0);
        ctx.restore();
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

// ==================== DISPLAY FUNCTIONS ====================
function updateDisplay() {
  initializeWheel();
  updateStats();
  updateLists();
}

function updateStats() {
  const participantCountEl = document.getElementById('participantCount');
  const queueCountEl = document.getElementById('queueCount');
  const totalWinnerCountEl = document.getElementById('totalWinnerCount');

  if (participantCountEl) {
    const participants = wheelSlots.filter(Boolean).length + waitingQueue.filter(addr => !recentWinners.includes(addr)).length;
    animateNumber(participantCountEl, parseInt(participantCountEl.textContent) || 0, participants);
  }

  if (queueCountEl) {
    const queueCount = waitingQueue.filter(addr => !recentWinners.includes(addr)).length;
    animateNumber(queueCountEl, parseInt(queueCountEl.textContent) || 0, queueCount);
  }

  if (totalWinnerCountEl) {
    animateNumber(totalWinnerCountEl, parseInt(totalWinnerCountEl.textContent) || 0, recentWinners.length);
  }
}

function updateLists() {
  // Update waiting queue list
  const queueContainer = document.getElementById('waitingQueueList');
  if (queueContainer) {
    const queueHTML = [];
    
    const displayQueue = waitingQueue.filter(addr => !recentWinners.includes(addr));
    
    if (displayQueue.length > 0) {
      displayQueue.forEach((address, index) => {
        queueHTML.push(`<div class="list-item">
          <span class="list-number">${index + 1}.</span>
          <span class="list-address">${formatAddress(address)}</span>
        </div>`);
      });
    }
    
    const minItems = 11;
    if (displayQueue.length < minItems) {
      for (let i = displayQueue.length; i < minItems; i++) {
        queueHTML.push(`<div class="list-item">
          <span class="list-number">${i + 1}.</span>
          <span class="list-address">-</span>
        </div>`);
      }
    }
    
    queueContainer.innerHTML = queueHTML.join('');
  }

  // Update recent winners list
  const winnersContainer = document.getElementById('recentWinnersList');
  if (winnersContainer) {
    const winnersHTML = [];
    
    const displayWinners = recentWinners.slice().reverse();
    
    if (displayWinners.length > 0) {
      displayWinners.forEach((address, index) => {
        winnersHTML.push(`<div class="list-item">
          <span class="list-number">${index + 1}.</span>
          <span class="list-address">${formatAddress(address)}</span>
        </div>`);
      });
    }
    
    const minWinnerItems = 11;
    if (displayWinners.length < minWinnerItems) {
      for (let i = displayWinners.length; i < minWinnerItems; i++) {
        winnersHTML.push(`<div class="list-item">
          <span class="list-number">${i + 1}.</span>
          <span class="list-address">-</span>
        </div>`);
      }
    }
    
    winnersContainer.innerHTML = winnersHTML.join('');
  }
}

// ==================== SOCIAL FUNCTIONS ====================
function openSocialMedia() {
  window.open('https://twitter.com/yourhandle', '_blank');
}

// ==================== CLEANUP FUNCTIONS ====================
function cleanup() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  
  if (realTimeSubscription) {
    realTimeSubscription.unsubscribe();
    realTimeSubscription = null;
  }
  
  if (handleRealTimeUpdate.timeout) {
    clearTimeout(handleRealTimeUpdate.timeout);
  }
}

window.addEventListener('beforeunload', cleanup);
window.addEventListener('unload', cleanup);

// ==================== ERROR HANDLING ====================
window.addEventListener('error', function(event) {
  console.error('❌ Global error:', event.error);
  showMessage('An unexpected error occurred. Please refresh the page.', 'error');
});

window.addEventListener('unhandledrejection', function(event) {
  console.error('❌ Unhandled promise rejection:', event.reason);
  showMessage('A network error occurred. Please check your connection.', 'error');
});

// ==================== INITIALIZATION ====================
async function initializeGame() {
  if (gameInitialized) {
    console.log('⚠️ Game already initialized');
    return;
  }

  console.log('🔄 Initializing game...');
  gameInitialized = true;

  try {
    await initializeSpinLock();
    console.log('✅ Spin lock initialized');

    await setupRealTimeSync();
    console.log('✅ Real-time sync initialized');

    await loadGameState();
    console.log('✅ Game state loaded');

    
    const slotsUpdated = fillEmptySlots();
    if (slotsUpdated) {
      await saveGameState();
      console.log('✅ Auto-filled empty slots on startup');
    }

    initializeWheel();
    updateDisplay();

    
    if (!countdownInterval) {
      console.log('⏰ Starting countdown timer');
      startCountdown();
    }

    console.log('✅ Game initialization completed successfully');
    showMessage('Game loaded successfully! 🎉', 'success');

    return true;
  } catch (error) {
    console.error('❌ Failed to initialize game:', error);
    showMessage('Failed to load game. Some features may not work properly.', 'error');
    
    // Fallback initialization
    wheelSlots = Array(WHEEL_SLOTS).fill(null);
    waitingQueue = [];
    recentWinners = [];
    countdownTimer = SPIN_INTERVAL;
    lastSpinTimestamp = Date.now();
    
    startCountdown();
    
    return false;
  }
}

// ==================== EVENT LISTENERS ====================
document.addEventListener('DOMContentLoaded', async function() {
  console.log('🔄 DOM loaded, starting application...');
  
  const container = document.querySelector('.container');
  showLoading(container);
  
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    
    await initializeGame();

    const walletInput = document.getElementById('walletAddress');
    if (walletInput) {
      walletInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          validateAddress();
        }
      });
      
      walletInput.addEventListener('input', function() {
        const msg = document.getElementById('message');
        const currentMessage = msg?.querySelector('.error-message');
        if (currentMessage) {
          msg.innerHTML = '';
        }
      });
    }

    document.addEventListener('click', function(e) {
      if (e.target.classList.contains('list-address') && e.target.textContent !== '-') {
        const address = e.target.textContent;
        const fullAddress = [...wheelSlots.filter(Boolean), ...waitingQueue, ...recentWinners]
          .find(addr => formatAddress(addr) === address);
        
        if (fullAddress && navigator.clipboard) {
          navigator.clipboard.writeText(fullAddress).then(() => {
            showMessage('Address copied to clipboard! 📋', 'success');
          }).catch(() => {
            showMessage('Could not copy to clipboard. Please copy manually.', 'info');
          });
        }
      }
    });

    
    const debugMode = window.location.hash.includes('debug') || window.location.search.includes('debug');
    if (debugMode) {
      const debugPanel = document.createElement('div');
      debugPanel.style.cssText = 'position: fixed; top: 10px; right: 10px; background: rgba(0,0,0,0.9); color: white; padding: 15px; border-radius: 8px; z-index: 1000; font-family: monospace; font-size: 12px;';
      debugPanel.innerHTML = `
        <div style="margin-bottom: 10px; font-weight: bold; color: #00ff00;">🔧 DEBUG MODE</div>
        <button onclick="window.debugFunctions.testSpin()" style="margin: 2px; padding: 5px 8px; font-size: 11px;">🎪 Force Spin</button>
        <button onclick="window.debugFunctions.addTestUser()" style="margin: 2px; padding: 5px 8px; font-size: 11px;">➕ Add Test User</button>
        <button onclick="window.debugFunctions.logState()" style="margin: 2px; padding: 5px 8px; font-size: 11px;">📊 Log State</button>
        <br>
        <button onclick="window.debugFunctions.setTimer(10)" style="margin: 2px; padding: 5px 8px; font-size: 11px;">⏰ Set 10s</button>
        <button onclick="window.debugFunctions.resetTimer()" style="margin: 2px; padding: 5px 8px; font-size: 11px;">🔄 Reset Timer</button>
        <br>
        <button onclick="window.debugFunctions.forceReleaseLock()" style="margin: 2px; padding: 5px 8px; font-size: 11px;">🔓 Force Release</button>
        <button onclick="window.debugFunctions.checkLockStatus()" style="margin: 2px; padding: 5px 8px; font-size: 11px;">🔍 Check Lock</button>
        <br>
        <button onclick="window.debugFunctions.resetSpin()" style="margin: 2px; padding: 5px 8px; font-size: 11px;">🔄 Reset Spin</button>
        <button onclick="window.debugFunctions.fillSlots()" style="margin: 2px; padding: 5px 8px; font-size: 11px;">🔄 Fill Slots</button>
        <div style="margin-top: 8px; font-size: 10px; color: #888;">
          Timer: <span id="debugTimer">--:--</span><br>
          Participants: <span id="debugParticipants">0</span><br>
          Queue: <span id="debugQueue">0</span><br>
          Winners: <span id="debugWinners">0</span><br>
          Spinning: <span id="debugSpinning">false</span>
        </div>
      `;
      document.body.appendChild(debugPanel);
      
      setInterval(() => {
        const debugTimer = document.getElementById('debugTimer');
        const debugParticipants = document.getElementById('debugParticipants');
        const debugQueue = document.getElementById('debugQueue');
        const debugWinners = document.getElementById('debugWinners');
        const debugSpinning = document.getElementById('debugSpinning');
        
        if (debugTimer) {
          const minutes = Math.floor(countdownTimer / 60).toString().padStart(2, '0');
          const seconds = (countdownTimer % 60).toString().padStart(2, '0');
          debugTimer.textContent = `${minutes}:${seconds}`;
        }
        if (debugParticipants) debugParticipants.textContent = wheelSlots.filter(Boolean).length;
        if (debugQueue) debugQueue.textContent = waitingQueue.length;
        if (debugWinners) debugWinners.textContent = recentWinners.length;
        if (debugSpinning) debugSpinning.textContent = isSpinning.toString();
      }, 1000);
      
      window.debugFunctions = {
        testSpin: () => {
          console.log('🔧 Manual spin triggered');
          if (isSpinning) {
            console.log('⚠️ Already spinning!');
            return;
          }
          performSpin();
        },
        
        addTestUser: () => {
          const testAddress = 'TEST' + Date.now().toString().slice(-8) + 'a'.repeat(35);
          const emptySlot = wheelSlots.findIndex(slot => !slot);
          if (emptySlot !== -1) {
            wheelSlots[emptySlot] = testAddress;
          } else {
            waitingQueue.push(testAddress);
          }
          updateDisplay();
          console.log('🔧 Added test user:', formatAddress(testAddress));
        },
        
        logState: () => {
          console.log('🔧 Current game state:', {
            wheelSlots: wheelSlots.map((slot, i) => `${i}: ${slot ? formatAddress(slot) : 'empty'}`),
            waitingQueue: waitingQueue.map(addr => formatAddress(addr)),
            recentWinners: recentWinners.map(addr => formatAddress(addr)),
            countdownTimer,
            isSpinning,
            wheelRotation: wheelRotation.toFixed(2),
            gameInitialized,
            lastSpinTimestamp: lastSpinTimestamp ? new Date(lastSpinTimestamp).toLocaleTimeString() : 'null'
          });
        },
        
        setTimer: (seconds) => {
          countdownTimer = seconds;
          console.log('🔧 Timer set to', seconds, 'seconds');
        },
        
        resetTimer: () => {
          countdownTimer = SPIN_INTERVAL;
          console.log('🔧 Timer reset to', SPIN_INTERVAL, 'seconds');
        },
        
        forceReleaseLock: async () => {
          await releaseSpinLock();
          isSpinning = false;
          console.log('🔧 Spin lock released and spinning flag reset');
        },
        
        checkLockStatus: async () => {
          if (supabase) {
            const { data } = await supabase
              .from('settings')
              .select('*')
              .eq('key', 'spin_lock')
              .maybeSingle();
            console.log('🔧 Lock status in DB:', data?.value || 'not found');
          }
          console.log('🔧 Local spinning flag:', isSpinning);
        },

        
        resetSpin: async () => {
          await releaseSpinLock();
          await markSpinCompleted();
          isSpinning = false;
          wheelRotation = 0;
          initializeWheel();
          console.log('🔧 Spin state completely reset');
        },

        
        fillSlots: async () => {
          const filled = fillEmptySlots();
          if (filled) {
            await saveGameState();
            updateDisplay();
            console.log('🔧 Empty slots filled from queue');
          } else {
            console.log('🔧 No empty slots to fill or no queue available');
          }
        }
      };
      
      console.log('🔧 Debug mode enabled - check the debug panel');
    }

  } catch (error) {
    console.error('❌ Failed to load application:', error);
    showMessage('Failed to load application. Please refresh the page.', 'error');
  } finally {
    hideLoading(container);
  }
});

document.addEventListener('visibilitychange', function() {
  if (!document.hidden && gameInitialized) {
    console.log('🔄 Page became visible, syncing game state...');
    loadGameState().then(() => {
      
      const slotsUpdated = fillEmptySlots();
      if (slotsUpdated) {
        saveGameState();
      }
      
      updateDisplay();
      if (!countdownInterval) {
        startCountdown();
      }
    });
  }
});

// ==================== EXPOSE FUNCTIONS TO GLOBAL SCOPE ====================
window.validateAddress = validateAddress;
window.openSocialMedia = openSocialMedia;

if (window.location.hash.includes('debug') || window.location.search.includes('debug')) {
  window.resetGame = async () => {
    if (confirm('Are you sure you want to reset the entire game? This will clear all data.')) {
      wheelSlots = Array(WHEEL_SLOTS).fill(null);
      waitingQueue = [];
      recentWinners = [];
      countdownTimer = SPIN_INTERVAL;
      lastSpinTimestamp = Date.now();
      isSpinning = false;
      
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      
      await saveGameState();
      await markSpinCompleted(); 
      updateDisplay();
      startCountdown();
      console.log('🔄 Game reset completed');
    }
  };
}

 function copyText() {

    const text = document.getElementById("myText").innerText;
    
    navigator.clipboard.writeText(text).then(() => {
     
    });
  }