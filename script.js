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
    // PERBAIKAN: Hapus message lama dengan smooth transition
    msg.innerHTML = '';
    
    // Tunggu sebentar lalu tampilkan message baru (untuk trigger animation)
    setTimeout(() => {
      msg.innerHTML = `<div class="message ${type}-message">${text}</div>`;
    }, 50);
    
    // PERBAIKAN: Auto-hide success/info messages setelah 5 detik
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

// PERBAIKAN: Animasi untuk perubahan angka
function animateNumber(element, from, to) {
  if (from === to) return;
  
  const duration = 500; // 0.5 second
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing function
    const easeOutQuart = 1 - Math.pow(1 - progress, 4);
    const current = Math.round(from + (to - from) * easeOutQuart);
    
    element.textContent = current;
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

// ==================== DATABASE FUNCTIONS ====================
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

// ==================== WHEEL FUNCTIONS ====================
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
    
    // Segment background - add alternating colors for better visibility
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.lineTo(centerX, centerY);
    
    if (wheelSlots[i]) {
      // Alternating colors for filled slots
      ctx.fillStyle = i % 2 === 0 ? '#f8f8f8' : '#e8e8e8';
    } else {
      ctx.fillStyle = '#ffffff';
    }
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
      ctx.font = 'bold 10px Arial';
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

  // PERBAIKAN: Draw pointer at top (12 o'clock position)
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - radius - 20); // Top point
  ctx.lineTo(centerX - 15, centerY - radius - 5); // Left point
  ctx.lineTo(centerX + 15, centerY - radius - 5); // Right point
  ctx.closePath();
  ctx.fillStyle = '#ff4444'; // Red color for better visibility
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.stroke();

  // PERBAIKAN: Add pointer shadow for depth
  ctx.beginPath();
  ctx.moveTo(centerX + 2, centerY - radius - 18);
  ctx.lineTo(centerX - 13, centerY - radius - 3);
  ctx.lineTo(centerX + 17, centerY - radius - 3);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
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
    console.error('❌ Element tidak ditemukan');
    return;
  }

  const address = input.value.trim();

  // Clear previous messages
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

  // Check if address is already in the system
  if (wheelSlots.includes(address) || waitingQueue.includes(address)) {
    showMessage('This address is already participating in the game', 'info');
    return;
  }

  // Show loading states
  showLoading(validationCard);
  disableButton(verifyBtn, 'Validating...');
  showMessage('Validating token holder status...', 'info');

  try {
    const isHolder = await validateHolder(address);
    
    if (isHolder) {
      currentUser = address;
      showMessage('Congrats anda adalah holder! 🎉', 'success');
      await addUserToSystem(currentUser);
      updateDisplay();
      
      // Clear input after successful validation
      input.value = '';
    } else {
      showMessage('You are not a token holder ❌', 'error');
      input.focus();
    }
  } catch (error) {
    console.error('Validation error:', error);
    showMessage('Validation failed. Please try again.', 'error');
  } finally {
    // Hide loading states
    hideLoading(validationCard);
    enableButton(verifyBtn);
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

// ==================== SPIN FUNCTIONS ====================
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

  // PERBAIKAN: Calculate final rotation to make spinning more natural
  // Multiple full rotations + random final position
  const minSpins = 4; // Minimum 4 full rotations
  const maxSpins = 7; // Maximum 7 full rotations  
  const spins = minSpins + Math.random() * (maxSpins - minSpins);
  const randomFinalAngle = Math.random() * 2 * Math.PI;
  
  const totalRotation = spins * 2 * Math.PI + randomFinalAngle;
  const duration = 3000 + Math.random() * 2000; // 3-5 seconds for more suspense

  console.log('🎪 Starting spin:', {
    spins: spins.toFixed(1),
    finalAngle: (randomFinalAngle * 180 / Math.PI).toFixed(1) + '°',
    duration: (duration / 1000).toFixed(1) + 's'
  });

  // Show spinning message
  showMessage('🎪 Wheel is spinning...', 'info');

  // Animate wheel spinning with more realistic easing
  gsap.to({ rotation: wheelRotation }, {
    rotation: wheelRotation + totalRotation,
    duration: duration / 1000,
    ease: "power3.out", // More natural deceleration
    onUpdate: function() {
      wheelRotation = this.targets()[0].rotation;
      initializeWheel();
    },
    onComplete: function() {
      // Clear spinning message
      const msg = document.getElementById('message');
      if (msg && msg.innerHTML.includes('spinning')) {
        msg.innerHTML = '';
      }
      selectWinner();
    }
  });
}

// PERBAIKAN: Function untuk highlight winning slot
async function highlightWinningSlot(slotIndex) {
  const canvas = document.getElementById('wheelCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = 140;
  const anglePerSlot = (2 * Math.PI) / WHEEL_SLOTS;

  // Highlight animation
  for (let i = 0; i < 6; i++) {
    // Redraw wheel
    initializeWheel();
    
    // Draw highlight on winning slot
    if (i % 2 === 0) { // Flash effect
      const startAngle = slotIndex * anglePerSlot + wheelRotation;
      const endAngle = (slotIndex + 1) * anglePerSlot + wheelRotation;
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.lineTo(centerX, centerY);
      ctx.fillStyle = 'rgba(255, 215, 0, 0.7)'; // Gold highlight
      ctx.fill();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 4;
      ctx.stroke();
      
      // Redraw text on highlighted slot
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

async function selectWinner() {
  const filledSlots = wheelSlots.filter(Boolean);
  if (filledSlots.length === 0) return;

  // PERBAIKAN: Determine winner based on wheel position relative to TOP pointer (12 o'clock)
  // Normalize rotation to 0-2π range
  const normalizedRotation = (wheelRotation % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const anglePerSlot = (2 * Math.PI) / WHEEL_SLOTS;
  
  // Calculate which slot is currently at the TOP (where the pointer is)
  // We add π/2 (90 degrees) to account for starting position and pointer at top
  const pointerAngle = (3 * Math.PI / 2 - normalizedRotation + 2 * Math.PI) % (2 * Math.PI);
  const winnerSlotIndex = Math.floor(pointerAngle / anglePerSlot) % WHEEL_SLOTS;
  
  const winner = wheelSlots[winnerSlotIndex];

  console.log('🎯 Spin Results:', {
    normalizedRotation: (normalizedRotation * 180 / Math.PI).toFixed(1) + '°',
    pointerAngle: (pointerAngle * 180 / Math.PI).toFixed(1) + '°',
    winnerSlotIndex,
    winner: winner ? formatAddress(winner) : 'Empty slot'
  });

  if (winner) {
    // PERBAIKAN: Highlight winning slot briefly
    await highlightWinningSlot(winnerSlotIndex);

    // PERBAIKAN: Animasi confetti atau celebration effect (jika ada library)
    if (typeof confetti !== 'undefined') {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }

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
    
    // PERBAIKAN: Better winner announcement dengan modal-style alert
    setTimeout(() => {
      if (confirm(`🎉 CONGRATULATIONS! 🎉\n\nWinner: ${formatAddress(winner)}\nFull Address: ${winner}\n\nClick OK to continue or Cancel to copy address`)) {
        // User clicked OK
      } else {
        // Copy to clipboard if user clicked Cancel
        if (navigator.clipboard) {
          navigator.clipboard.writeText(winner).then(() => {
            showMessage('Winner address copied to clipboard! 📋', 'success');
          });
        }
      }
    }, 1500); // Delay untuk memberi waktu highlight effect
  } else {
    console.log('⚠️ No winner - empty slot selected');
    showMessage('Spin landed on empty slot, spinning again in next cycle', 'info');
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
    
    // PERBAIKAN: Animate number changes
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

// PERBAIKAN: updateLists function yang menampilkan SEMUA data dengan scroll
function updateLists() {
  // Update waiting queue list
  const queueContainer = document.getElementById('waitingQueueList');
  if (queueContainer) {
    const queueHTML = [];
    
    // Show ALL queue items (excluding winners)
    const displayQueue = waitingQueue.filter(addr => !recentWinners.includes(addr));
    
    if (displayQueue.length > 0) {
      // Tampilkan semua data yang ada
      displayQueue.forEach((address, index) => {
        queueHTML.push(`<div class="list-item">
          <span class="list-number">${index + 1}.</span>
          <span class="list-address">${formatAddress(address)}</span>
        </div>`);
      });
    }
    
    // Jika tidak ada data atau kurang dari 11, tampilkan placeholder minimal 11 item
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
    
    // Show ALL recent winners (latest first), tidak dibatasi 11
    const displayWinners = recentWinners.slice().reverse(); // Ambil semua, terbaru dulu
    
    if (displayWinners.length > 0) {
      displayWinners.forEach((address, index) => {
        winnersHTML.push(`<div class="list-item">
          <span class="list-number">${index + 1}.</span>
          <span class="list-address">${formatAddress(address)}</span>
        </div>`);
      });
    }
    
    // Jika winner masih sedikit, tambahkan placeholder
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
  // Replace with your social media URL
  window.open('https://twitter.com/yourhandle', '_blank');
}

// ==================== EVENT LISTENERS ====================
document.addEventListener('DOMContentLoaded', async function() {
  console.log('🔄 Loading application...');
  
  // PERBAIKAN: Definisikan utility functions secara lokal jika belum ada
  const showLoadingLocal = (element) => {
    if (element && element.classList) {
      element.classList.add('loading');
    }
  };
  
  const hideLoadingLocal = (element) => {
    if (element && element.classList) {
      element.classList.remove('loading');
    }
  };
  
  // PERBAIKAN: Show loading state during initialization
  const container = document.querySelector('.container');
  showLoadingLocal(container);
  
  try {
    // Tunggu sedikit untuk memastikan semua library dimuat
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // PERBAIKAN: Initialize spin lock dan real-time sync
    await initializeSpinLock();
    await setupRealTimeSync();
    
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
    hideLoadingLocal(container);
  }
});

// ==================== EXPOSE FUNCTIONS TO GLOBAL SCOPE ====================
window.validateAddress = validateAddress;
window.openSocialMedia = openSocialMedia;