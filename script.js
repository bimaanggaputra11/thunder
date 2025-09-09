// PERBAIKAN UTAMA: Fungsi untuk menentukan pemenang dengan posisi yang tepat
function determineWinnerWithCorrectPosition(filledSlots, randomSeed) {
  const seededRandomValue = seededRandom(randomSeed);
  const winnerIndex = Math.floor(seededRandomValue * filledSlots.length);
  const winnerSlot = filledSlots[winnerIndex].slotIndex;
  const winnerAddress = filledSlots[winnerIndex].address;

  // PERBAIKAN: Hitung angle per slot dengan benar
  const anglePerSlot = (2 * Math.PI) / WHEEL_SLOTS;
  
  // PERBAIKAN: Hitung posisi slot pemenang dari titik 0 (jam 3)
  // Slot 0 dimulai dari jam 3, jadi untuk mendapatkan jam 12 kita perlu offset
  const slotAngleFromThreeOClock = winnerSlot * anglePerSlot;
  
  // PERBAIKAN: Offset untuk membuat jam 12 sebagai posisi 0
  // Jam 12 adalah -90 derajat dari jam 3, atau -π/2 radian
  const twelveOClockOffset = -Math.PI / 2;
  
  // PERBAIKAN: Hitung berapa banyak wheel harus berputar agar slot pemenang 
  // berada di posisi jam 12 (di bawah triangle pointer)
  const currentWheelRotation = wheelRotation % (2 * Math.PI);
  const targetSlotPosition = slotAngleFromThreeOClock + currentWheelRotation;
  
  // PERBAIKAN: Hitung rotasi yang dibutuhkan untuk membawa slot pemenang ke jam 12
  // Kita ingin slot berada di twelveOClockOffset position
  let rotationNeeded = twelveOClockOffset - targetSlotPosition;
  
  // PERBAIKAN: Normalisasi agar rotasi selalu positif dan dalam range yang benar
  while (rotationNeeded <= 0) {
    rotationNeeded += 2 * Math.PI;
  }
  
  // PERBAIKAN: Tambahkan putaran ekstra untuk animasi yang menarik
  const spinSeed1 = seededRandom(randomSeed + 1);
  const spinSeed2 = seededRandom(randomSeed + 2);
  
  const minSpins = 4;
  const maxSpins = 6;
  const extraSpins = minSpins + spinSeed1 * (maxSpins - minSpins);
  
  // PERBAIKAN: Total rotasi = putaran ekstra + rotasi yang dibutuhkan untuk positioning
  const totalRotation = (extraSpins * 2 * Math.PI) + rotationNeeded;
  
  const spinDuration = 3000 + spinSeed2 * 2000;
  
  console.log('🎯 Winner positioning calculation:', {
    winnerSlot: winnerSlot,
    anglePerSlot: (anglePerSlot * 180 / Math.PI).toFixed(1) + '°',
    slotAngleFromThreeOClock: (slotAngleFromThreeOClock * 180 / Math.PI).toFixed(1) + '°',
    currentWheelRotation: (currentWheelRotation * 180 / Math.PI).toFixed(1) + '°',
    targetSlotPosition: (targetSlotPosition * 180 / Math.PI).toFixed(1) + '°',
    rotationNeeded: (rotationNeeded * 180 / Math.PI).toFixed(1) + '°',
    extraSpins: extraSpins.toFixed(1),
    totalRotation: (totalRotation * 180 / Math.PI).toFixed(1) + '°'
  });
  
  return {
    winnerSlot,
    winnerAddress,
    targetRotation: totalRotation,
    spinDuration
  };
}

// PERBAIKAN: Update fungsi determineWinnerOnServer
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
    
    // PERBAIKAN: Gunakan fungsi positioning yang sudah diperbaiki
    const result = determineWinnerWithCorrectPosition(filledSlots, randomSeed);
    
    const spinId = `spin_${randomSeed}_${currentTimeSecond}`;
    const spinStartTime = Date.now();

    // Simpan ke database
    const { error } = await supabase
      .from('spin_state')
      .update({
        spin_id: spinId,
        winner_slot: result.winnerSlot,
        winner_address: result.winnerAddress,
        target_rotation: result.targetRotation,
        spin_duration: result.spinDuration,
        spin_start_time: spinStartTime,
        is_active: true,
        participants_snapshot: JSON.stringify(filledSlots),
        random_seed: randomSeed
      })
      .eq('id', 1);

    if (error) throw error;

    console.log('🎯 Winner determined on server (perfect positioning):', {
      spinId,
      randomSeed,
      winnerSlot: result.winnerSlot,
      winnerAddress: formatAddress(result.winnerAddress),
      targetRotation: (result.targetRotation * 180 / Math.PI).toFixed(1) + '°',
      spinDuration: (result.spinDuration / 1000).toFixed(1) + 's'
    });

    return {
      spinId,
      winnerSlot: result.winnerSlot,
      winnerAddress: result.winnerAddress,
      targetRotation: result.targetRotation,
      spinDuration: result.spinDuration,
      spinStartTime,
      randomSeed
    };
  } catch (error) {
    console.error('❌ Failed to determine winner on server:', error);
    return determineWinnerLocally();
  }
}

// PERBAIKAN: Update fungsi determineWinnerLocally 
function determineWinnerLocally() {
  const filledSlots = wheelSlots.map((slot, index) => slot !== null ? { address: slot, slotIndex: index } : null)
                                .filter(Boolean);

  if (filledSlots.length === 0) {
    console.log('⚠️ No participants to determine winner from');
    return null;
  }

  const currentTimeSecond = Math.floor(Date.now() / 1000);
  const randomSeed = currentTimeSecond;
  
  // PERBAIKAN: Gunakan fungsi positioning yang sudah diperbaiki
  const result = determineWinnerWithCorrectPosition(filledSlots, randomSeed);
  
  const spinStartTime = Date.now();
  const spinId = `local_spin_${randomSeed}_${currentTimeSecond}`;

  console.log('🎯 Winner determined locally (perfect positioning):', {
    spinId,
    randomSeed,
    winnerSlot: result.winnerSlot,
    winnerAddress: formatAddress(result.winnerAddress),
    targetRotation: (result.targetRotation * 180 / Math.PI).toFixed(1) + '°',
    spinDuration: (result.spinDuration / 1000).toFixed(1) + 's'
  });

  return {
    spinId,
    winnerSlot: result.winnerSlot,
    winnerAddress: result.winnerAddress,
    targetRotation: result.targetRotation,
    spinDuration: result.spinDuration,
    spinStartTime,
    randomSeed
  };
}

// PERBAIKAN: Fungsi untuk verifikasi positioning setelah spin selesai
function verifyWinnerPosition(winnerSlot) {
  const anglePerSlot = (2 * Math.PI) / WHEEL_SLOTS;
  const currentWheelRotation = wheelRotation % (2 * Math.PI);
  const slotAngleFromThreeOClock = winnerSlot * anglePerSlot;
  const slotCurrentPosition = slotAngleFromThreeOClock + currentWheelRotation;
  
  // Posisi jam 12 adalah -π/2 dari jam 3
  const twelveOClockPosition = -Math.PI / 2;
  
  // Normalisasi ke range [0, 2π]
  const normalizedSlotPosition = ((slotCurrentPosition % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
  const normalizedTwelveOClock = ((twelveOClockPosition % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
  
  const positionDifference = Math.abs(normalizedSlotPosition - normalizedTwelveOClock);
  const minDifference = Math.min(positionDifference, (2 * Math.PI) - positionDifference);
  
  console.log('🎯 Position verification:', {
    winnerSlot,
    slotCurrentPosition: (normalizedSlotPosition * 180 / Math.PI).toFixed(1) + '°',
    twelveOClockPosition: (normalizedTwelveOClock * 180 / Math.PI).toFixed(1) + '°',
    difference: (minDifference * 180 / Math.PI).toFixed(1) + '°',
    isAccurate: minDifference < (anglePerSlot / 4) // Toleransi 1/4 dari ukuran slot
  });
  
  return minDifference < (anglePerSlot / 4);
}

// PERBAIKAN: Update fungsi selectWinnerFromServer dengan verifikasi
async function selectWinnerFromServer(spinResult) {
  const { winnerSlot, winnerAddress } = spinResult;

  console.log('🎯 Processing server-determined winner:', {
    winnerSlot,
    winnerAddress: formatAddress(winnerAddress),
    randomSeed: spinResult.randomSeed
  });

  // PERBAIKAN: Verifikasi posisi setelah animasi selesai
  setTimeout(() => {
    const isAccurate = verifyWinnerPosition(winnerSlot);
    if (!isAccurate) {
      console.warn('⚠️ Winner position might not be perfectly aligned with triangle');
    } else {
      console.log('✅ Winner position is perfectly aligned with triangle!');
    }
  }, 100);

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
    
    // Auto fill empty slots setelah ada pemenang
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