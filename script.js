// Supabase Configuration
const SUPABASE_URL = 'https://bewuevhfiehsjofvwpbi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJld3VldmhmaWVoc2pvZnZ3cGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxNjA1MDEsImV4cCI6MjA3MjczNjUwMX0.o7KJ4gkbfZKYy3lvuV63yGM5XCnk5xk4vCLv46hNAII';

// PERBAIKAN: Gunakan window.supabase atau pastikan library dimuat
const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Configuration
const TOKEN_MINT = "ACbRrERR5GJnADhLhhanxrDCXJzGhyF64SKihbzBpump";
const WHEEL_SLOTS = 8; // Number of slots in the wheel
const SPIN_INTERVAL = 5 * 60; // 5 minutes in seconds

// PERBAIKAN: Inisialisasi variabel game state dengan nilai default
let wheelSlots = Array(WHEEL_SLOTS).fill(null);
let waitingQueue = [];
let recentWinners = []; // Inisialisasi dengan array kosong
let currentUser = null;
let countdownTimer = SPIN_INTERVAL;
let spinInterval = null;
let wheelRotation = 0;
let lastSpinTimestamp = null;

// Cek apakah Supabase tersedia
if (!supabase) {
  console.error('❌ Supabase client tidak dapat diinisialisasi. Pastikan library Supabase sudah dimuat.');
}

// Database functions
async function saveGameState() {
  if (!supabase) {
    console.error('❌ Supabase client tidak tersedia');
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

    // Save last spin timestamp
    if (lastSpinTimestamp) {
      await supabase.from('settings').upsert([{ 
        key: 'last_spin_timestamp', 
        value: String(lastSpinTimestamp) 
      }], { onConflict: 'key' });
    }

    console.log('✅ Game state saved to database');
  } catch (error) {
    console.error('❌ Failed to save game state:', error);
  }
}

async function loadGameState() {
  if (!supabase) {
    console.error('❌ Supabase client tidak tersedia');
    return;
  }

  try {
    // Load winners first (to exclude them from wheel and queue)
    const { data: winnersData } = await supabase
      .from('winners_list')
      .select('*')
      .order('timestamp', { ascending: true });

    const allWinners = winnersData ? winnersData.map(w => w.address) : [];
    recentWinners = [...new Set(allWinners)]; // Remove duplicates

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

    // Load last spin timestamp
    const { data: timestampData } = await supabase
      .from('settings')
      .select('*')
      .eq('key', 'last_spin_timestamp')
      .maybeSingle();

    if (timestampData?.value) {
      lastSpinTimestamp = parseInt(timestampData.value);
      calculateRemainingTime();
    } else {
      // If no timestamp exists, set current time as last spin
      lastSpinTimestamp = Date.now();
      countdownTimer = SPIN_INTERVAL;
      await saveGameState();
    }

    console.log('✅ Game state loaded from database');
  } catch (error) {
    console.error('❌ Failed to load game state:', error);
  }
}

function calculateRemainingTime() {
  if (!lastSpinTimestamp) {
    countdownTimer = SPIN_INTERVAL;
    return;
  }

  const elapsed = Math.floor((Date.now() - lastSpinTimestamp) / 1000);
  countdownTimer = Math.max(0, SPIN_INTERVAL - elapsed);
  
  if (countdownTimer === 0) {
    // If time has passed, perform spin immediately
    setTimeout(performSpin, 1000);
    countdownTimer = SPIN_INTERVAL;
  }
}

async function updateSpinTimestamp() {
  if (!supabase) {
    console.error('❌ Supabase client tidak tersedia');
    return;
  }

  lastSpinTimestamp = Date.now();
  await supabase.from('settings').upsert([{ 
    key: 'last_spin_timestamp', 
    value: String(lastSpinTimestamp) 
  }], { onConflict: 'key' });
}

// Initialize wheel canvas
function initializeWheel() {
  const canvas = document.getElementById('wheelCanvas');
  if (!canvas) {
    console.error('❌ Canvas element tidak ditemukan');
    return;
  }

  const ctx = canvas.getContext('2d');
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = 140;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw wheel segments
  const anglePerSlot = (2 * Math.PI) / WHEEL_SLOTS;
  
  for (let i = 0; i < WHEEL_SLOTS; i++) {
    const startAngle = i * anglePerSlot + wheelRotation;
    const endAngle = (i + 1) * anglePerSlot + wheelRotation;
    
    // Segment background
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.lineTo(centerX, centerY);
    ctx.fillStyle = wheelSlots[i] ? '#f0f0f0' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw text
    if (wheelSlots[i]) {
      const textAngle = startAngle + anglePerSlot / 2;
      const textX = centerX + Math.cos(textAngle) * (radius * 0.7);
      const textY = centerY + Math.sin(textAngle) * (radius * 0.7);
      
      ctx.save();
      ctx.translate(textX, textY);
      ctx.rotate(textAngle + Math.PI / 2);
      ctx.fillStyle = '#333';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(formatAddress(wheelSlots[i]), 0, 0);
      ctx.restore();
    } else {
      // Draw "Address holder" text for empty slots
      const textAngle = startAngle + anglePerSlot / 2;
      const textX = centerX + Math.cos(textAngle) * (radius * 0.7);
      const textY = centerY + Math.sin(textAngle) * (radius * 0.7);
      
      ctx.save();
      ctx.translate(textX, textY);
      ctx.rotate(textAngle + Math.PI / 2);
      ctx.fillStyle = '#999';
      ctx.font = '8px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Address holder', 0, 0);
      ctx.restore();
    }
  }

  // Draw center circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, 20, 0, 2 * Math.PI);
  ctx.fillStyle = '#333';
  ctx.fill();

  // Draw pointer (triangle pointing to the wheel)
  ctx.beginPath();
  ctx.moveTo(centerX + radius + 10, centerY);
  ctx.lineTo(centerX + radius - 10, centerY - 15);
  ctx.lineTo(centerX + radius - 10, centerY + 15);
  ctx.closePath();
  ctx.fillStyle = '#333';
  ctx.fill();
}

function formatAddress(address) {
  if (!address) return '';
  return `${address.slice(0, 4)}...${address.slice(-3)}`;
}

// Validate token holder
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

// PERBAIKAN: Validate wallet address dengan pengecekan yang lebih aman
async function validateAddress() {
  const input = document.getElementById('walletAddress');
  const msg = document.getElementById('message');
  
  if (!input || !msg) {
    console.error('❌ Element tidak ditemukan');
    return;
  }

  const address = input.value.trim();

  msg.innerHTML = '';

  if (!address) {
    showMessage('Please enter a wallet address', 'error');
    return;
  }

  if (address.length < 32 || address.length > 44) {
    showMessage('Invalid wallet address format', 'error');
    return;
  }

  // PERBAIKAN: Pastikan recentWinners sudah diinisialisasi
  if (!Array.isArray(recentWinners)) {
    console.warn('⚠️ recentWinners belum diinisialisasi, menggunakan array kosong');
    recentWinners = [];
  }

  // Check if address is already a winner
  if (recentWinners.includes(address)) {
    showMessage('This address has already won and cannot participate again', 'error');
    return;
  }

  showMessage('Validating token holder status...', 'info');

  const isHolder = await validateHolder(address);
  if (isHolder) {
    currentUser = address;
    showMessage('Congrats anda adalah holder', 'success');
    await addUserToSystem(currentUser);
    updateDisplay();
  } else {
    showMessage('You not a holder', 'error');
  }
}

function showMessage(text, type) {
  const msg = document.getElementById('message');
  if (msg) {
    msg.innerHTML = `<div class="message ${type}-message">${text}</div>`;
  }
}

async function addUserToSystem(address) {
  // Pastikan arrays sudah diinisialisasi
  if (!Array.isArray(recentWinners)) recentWinners = [];
  if (!Array.isArray(wheelSlots)) wheelSlots = Array(WHEEL_SLOTS).fill(null);
  if (!Array.isArray(waitingQueue)) waitingQueue = [];

  // Check if address is already in the system or is a winner
  if (recentWinners.includes(address) || 
      wheelSlots.includes(address) || 
      waitingQueue.includes(address)) {
    return;
  }

  const emptySlot = wheelSlots.findIndex(slot => !slot);
  if (emptySlot !== -1) {
    wheelSlots[emptySlot] = address;
  } else {
    waitingQueue.push(address);
  }

  await saveGameState();
}

function startCountdown() {
  if (spinInterval) clearInterval(spinInterval);

  spinInterval = setInterval(() => {
    countdownTimer--;
    updateCountdownDisplay();

    if (countdownTimer <= 0) {
      performSpin();
      countdownTimer = SPIN_INTERVAL;
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

async function performSpin() {
  const filledSlots = wheelSlots.filter(Boolean);
  if (filledSlots.length === 0) return;

  // Update spin timestamp
  await updateSpinTimestamp();

  // Check if GSAP is available
  if (typeof gsap === 'undefined') {
    console.error('❌ GSAP library tidak tersedia');
    // Fallback tanpa animasi
    selectWinner();
    return;
  }

  // Animate wheel spinning
  const totalRotation = Math.PI * 8 + Math.random() * Math.PI * 2; // 4 full rotations plus random
  const duration = 3000; // 3 seconds

  gsap.to({ rotation: wheelRotation }, {
    rotation: wheelRotation + totalRotation,
    duration: duration / 1000,
    ease: "power2.out",
    onUpdate: function() {
      wheelRotation = this.targets()[0].rotation;
      initializeWheel();
    },
    onComplete: function() {
      selectWinner();
    }
  });
}

async function selectWinner() {
  const filledSlots = wheelSlots.filter(Boolean);
  if (filledSlots.length === 0) return;

  // Determine winner based on wheel position
  const normalizedRotation = (wheelRotation % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const anglePerSlot = (2 * Math.PI) / WHEEL_SLOTS;
  const winnerSlotIndex = Math.floor(normalizedRotation / anglePerSlot);
  const winner = wheelSlots[winnerSlotIndex];

  if (winner) {
    // Add to winners
    recentWinners.push(winner);

    // Remove from wheel
    wheelSlots[winnerSlotIndex] = null;

    // Fill empty slot from queue (excluding winners)
    const availableQueueUsers = waitingQueue.filter(addr => !recentWinners.includes(addr));
    if (availableQueueUsers.length > 0) {
      const nextUser = availableQueueUsers[0];
      wheelSlots[winnerSlotIndex] = nextUser;
      waitingQueue = waitingQueue.filter(addr => addr !== nextUser);
    }

    // Remove winner from queue if they were there
    waitingQueue = waitingQueue.filter(addr => addr !== winner);

    await saveGameState();
    updateDisplay();
    alert(`🎉 Congratulations! Winner: ${formatAddress(winner)}`);
  }
}

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
    const participants = wheelSlots.filter(Boolean).length + waitingQueue.length;
    participantCountEl.textContent = participants;
  }

  if (queueCountEl) {
    queueCountEl.textContent = waitingQueue.length;
  }

  if (totalWinnerCountEl) {
    totalWinnerCountEl.textContent = recentWinners.length;
  }
}

function updateLists() {
  // Update waiting queue list
  const queueContainer = document.getElementById('waitingQueueList');
  if (queueContainer) {
    const queueHTML = [];
    
    // Show actual queue first (excluding winners)
    const displayQueue = waitingQueue.filter(addr => !recentWinners.includes(addr));
    displayQueue.forEach((address, index) => {
      queueHTML.push(`<div class="list-item">
        <span class="list-number">${index + 1}.</span>
        <span class="list-address">${formatAddress(address)}</span>
      </div>`);
    });
    
    // Fill remaining slots with placeholders
    for (let i = displayQueue.length; i < 11; i++) {
      queueHTML.push(`<div class="list-item">
        <span class="list-number">${i + 1}.</span>
        <span class="list-address">-</span>
      </div>`);
    }
    
    queueContainer.innerHTML = queueHTML.join('');
  }

  // Update recent winners list
  const winnersContainer = document.getElementById('recentWinnersList');
  if (winnersContainer) {
    const winnersHTML = [];
    
    // Show recent winners (latest first)
    const displayWinners = recentWinners.slice(-11).reverse();
    displayWinners.forEach((address, index) => {
      winnersHTML.push(`<div class="list-item">
        <span class="list-number">${index + 1}.</span>
        <span class="list-address">${formatAddress(address)}</span>
      </div>`);
    });
    
    // Fill remaining slots with placeholders
    for (let i = displayWinners.length; i < 11; i++) {
      winnersHTML.push(`<div class="list-item">
        <span class="list-number">${i + 1}.</span>
        <span class="list-address">-</span>
      </div>`);
    }
    
    winnersContainer.innerHTML = winnersHTML.join('');
  }
}

function openSocialMedia() {
  // Replace with your social media URL
  window.open('https://twitter.com/yourhandle', '_blank');
}

// Event listeners
document.addEventListener('DOMContentLoaded', async function() {
  console.log('🔄 Loading application...');
  
  // PERBAIKAN: Show loading state during initialization
  const container = document.querySelector('.container');
  showLoading(container);
  
  try {
    // Tunggu sedikit untuk memastikan semua library dimuat
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Load game state from database
    await loadGameState();
    
    // Initialize display
    initializeWheel();
    updateDisplay();
    
    // Start countdown with loaded time
    startCountdown();

    // Add event listeners
    const walletInput = document.getElementById('walletAddress');
    if (walletInput) {
      walletInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          validateAddress();
        }
      });
      
      // PERBAIKAN: Auto-clear error messages when user starts typing
      walletInput.addEventListener('input', function() {
        const msg = document.getElementById('message');
        const currentMessage = msg?.querySelector('.error-message');
        if (currentMessage) {
          msg.innerHTML = '';
        }
      });
    }

    // PERBAIKAN: Add click-to-copy functionality for addresses in lists
    document.addEventListener('click', function(e) {
      if (e.target.classList.contains('list-address') && e.target.textContent !== '-') {
        const address = e.target.textContent;
        // Find full address from our arrays
        const fullAddress = [...wheelSlots.filter(Boolean), ...waitingQueue, ...recentWinners]
          .find(addr => formatAddress(addr) === address);
        
        if (fullAddress && navigator.clipboard) {
          navigator.clipboard.writeText(fullAddress).then(() => {
            showMessage('Address copied to clipboard! 📋', 'success');
          });
        }
      }
    });

    console.log('✅ Application loaded successfully');
  } catch (error) {
    console.error('❌ Failed to load application:', error);
    showMessage('Failed to load application. Please refresh the page.', 'error');
  } finally {
    // PERBAIKAN: Hide loading state
    hideLoading(container);
  }
});

// Expose functions to global scope
window.validateAddress = validateAddress;
window.openSocialMedia = openSocialMedia;