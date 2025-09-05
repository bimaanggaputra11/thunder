// Configuration
const MINT_ADDRESS = "74x7Bu7JUAMGZ4G7v741pzSu7A7DvCxhnCeFoeyGpump";
const SOLANA_RPC = "https://rpc.ankr.com/solana";
const AUTO_SPIN_INTERVAL = 15 * 60 * 1000; // 15 minutes in milliseconds

// Storage keys
const STORAGE_KEYS = {
    HOLDERS: 'luckywheel_holders',
    WINNERS: 'luckywheel_winners',
    LAST_SPIN: 'luckywheel_last_spin'
};

// Utility functions for localStorage
const storage = {
    get: (key) => {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch (e) {
            console.error('Error reading from localStorage:', e);
            return null;
        }
    },
    set: (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.error('Error writing to localStorage:', e);
        }
    }
};

// Simple Base58 validation for Solana address
function isValidBase58(address) {
    const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;
    return BASE58_REGEX.test(address);
}

function isValidSolanaAddress(address) {
    // Solana address is base58 and length usually 32-44 characters
    if (!address) return false;
    if (address.length < 32 || address.length > 44) return false;
    if (!isValidBase58(address)) return false;
    return true;
}

// Solana token balance checker
async function checkTokenBalance(walletAddress) {
    console.log("Checking balance for:", walletAddress);
console.log("Using mint:", MINT_ADDRESS);
console.log("Sending request to:", SOLANA_RPC);

    try {
        const response = await fetch(SOLANA_RPC, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getTokenAccountsByOwner',
                params: [
                    walletAddress,
                    {
                        mint: MINT_ADDRESS
                    },
                    {
                        encoding: 'jsonParsed'
                    }
                ]
            })
        });

        const data = await response.json();
        console.log('RPC response:', data); // Debugging response
        
        if (data.error) {
            throw new Error(data.error.message);
        }

        if (data.result && data.result.value && data.result.value.length > 0) {
            const tokenAccount = data.result.value[0];
            const balance = parseFloat(tokenAccount.account.data.parsed.info.tokenAmount.uiAmount);
            return balance > 0;
        }

        return false;
    } catch (error) {
        console.error('Error checking token balance:', error);
        return false;
    }
    
}

// Main page functionality
if (document.getElementById('checkEligibility')) {
    const walletAddressInput = document.getElementById('walletAddress');
    const checkButton = document.getElementById('checkEligibility');
    const submitButton = document.getElementById('submitAddress');
    const resultDiv = document.getElementById('result');
    const validHolderDiv = document.getElementById('validHolder');
    const invalidHolderDiv = document.getElementById('invalidHolder');
    const loadingDiv = document.getElementById('loading');

    checkButton.addEventListener('click', async () => {
        const address = walletAddressInput.value.trim();
        
        if (!address) {
            alert('Please enter a wallet address');
            return;
        }

        if (!isValidSolanaAddress(address)) {
            alert('Please enter a valid Solana wallet address');
            return;
        }

        loadingDiv.style.display = 'block';
        resultDiv.style.display = 'none';
        checkButton.disabled = true;

        try {
            const isHolder = await checkTokenBalance(address);
            
            loadingDiv.style.display = 'none';
            resultDiv.style.display = 'block';

            if (isHolder) {
                validHolderDiv.style.display = 'block';
                invalidHolderDiv.style.display = 'none';
            } else {
                validHolderDiv.style.display = 'none';
                invalidHolderDiv.style.display = 'block';
            }
        } catch (error) {
            loadingDiv.style.display = 'none';
            alert('Error checking eligibility. Please try again.');
            console.error(error);
        } finally {
            checkButton.disabled = false;
        }
    });

    submitButton.addEventListener('click', async () => {
        const address = walletAddressInput.value.trim();

        if (!address) {
            alert('Please enter a wallet address');
            return;
        }

        if (!isValidSolanaAddress(address)) {
            alert('Please enter a valid Solana wallet address');
            return;
        }

        // Double-check token holder status before submit
        const isHolder = await checkTokenBalance(address);
        if (!isHolder) {
            alert('Address is not a token holder!');
            return;
        }

        const holders = storage.get(STORAGE_KEYS.HOLDERS) || [];

        if (holders.includes(address)) {
            alert('This address is already registered!');
            return;
        }

        holders.push(address);
        storage.set(STORAGE_KEYS.HOLDERS, holders);

        alert('Address successfully registered! Redirecting to Lucky Wheel...');
        window.location.href = 'luckywheel.html';
    });
}

// Lucky Wheel functionality
if (document.getElementById('wheelCanvas')) {
    const canvas = document.getElementById('wheelCanvas');
    const ctx = canvas.getContext('2d');
    const spinButton = document.getElementById('spinButton');
    const countdownElement = document.getElementById('countdown');
    
    let isSpinning = false;
    let currentRotation = 0;
    let countdownTimer;

    // Wheel colors
    const colors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
        '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
        '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D5A6BD',
        '#A9CCE3', '#A3E4D7', '#D5DBDB', '#FADBD8', '#E8DAEF'
    ];

    function drawWheel(holders) {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = 180;
        
        if (!holders || holders.length === 0) {
            // Draw empty wheel
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            ctx.fillStyle = '#f0f0f0';
            ctx.fill();
            ctx.strokeStyle = '#ddd';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            ctx.fillStyle = '#666';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No holders yet', centerX, centerY);
            return;
        }

        const anglePerSlice = (2 * Math.PI) / Math.min(holders.length, 20);
        const displayHolders = holders.slice(0, 20);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw wheel slices
        displayHolders.forEach((holder, index) => {
            const startAngle = currentRotation + index * anglePerSlice;
            const endAngle = currentRotation + (index + 1) * anglePerSlice;
            
            // Draw slice
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.closePath();
            ctx.fillStyle = colors[index % colors.length];
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Draw text
            const textAngle = startAngle + anglePerSlice / 2;
            const textX = centerX + Math.cos(textAngle) * (radius * 0.7);
            const textY = centerY + Math.sin(textAngle) * (radius * 0.7);
            
            ctx.save();
            ctx.translate(textX, textY);
            ctx.rotate(textAngle + Math.PI / 2);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowOffsetX = 1;
            ctx.shadowOffsetY = 1;
            const shortAddress = holder.slice(0, 4) + '...' + holder.slice(-4);
            ctx.fillText(shortAddress, 0, 0);
            ctx.restore();
        });
    }

    function spinWheel() {
        if (isSpinning) return;
        
        const holders = storage.get(STORAGE_KEYS.HOLDERS) || [];
        if (holders.length === 0) {
            alert('No holders to spin!');
            return;
        }

        isSpinning = true;
        spinButton.style.pointerEvents = 'none';
        spinButton.style.opacity = '0.5';
        
        const displayHolders = holders.slice(0, 20);
        const spinDegrees = 1440 + Math.random() * 1440; // 4-8 full rotations
        const finalRotation = currentRotation + (spinDegrees * Math.PI / 180);
        
        // Animation
        const startTime = Date.now();
        const duration = 3000; // 3 seconds
        
        function animate() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function for smooth deceleration
            const easeOut = 1 - Math.pow(1 - progress, 3);
            currentRotation = currentRotation + (finalRotation - currentRotation) * easeOut;
            
            drawWheel(displayHolders);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Determine winner
                const normalizedRotation = (currentRotation % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
                const pointerAngle = -Math.PI / 2; // Pointer at top
                const relativeAngle = (pointerAngle - normalizedRotation + 2 * Math.PI) % (2 * Math.PI);
                const anglePerSlice = (2 * Math.PI) / displayHolders.length;
                const winnerIndex = Math.floor(relativeAngle / anglePerSlice);
                const winner = displayHolders[winnerIndex];
                
                // Move winners to history and remove from holders
                const winners = storage.get(STORAGE_KEYS.WINNERS) || [];
                winners.push({
                    address: winner,
                    timestamp: new Date().toISOString(),
                    spinTime: new Date().toLocaleString()
                });
                storage.set(STORAGE_KEYS.WINNERS, winners);
                
                // Remove winner from holders
                const updatedHolders = holders.filter(h => h !== winner);
                storage.set(STORAGE_KEYS.HOLDERS, updatedHolders);
                
                // Update displays
                updateHoldersList();
                updateWinnersList();
                
                // Show winner
                setTimeout(() => {
                    alert(`🎉 Winner: ${winner.slice(0, 8)}...${winner.slice(-8)}`);
                }, 500);
                
                // Reset spin state
                isSpinning = false;
                spinButton.style.pointerEvents = 'auto';
                spinButton.style.opacity = '1';
                
                // Update last spin time and restart timer
                storage.set(STORAGE_KEYS.LAST_SPIN, Date.now());
                startAutoSpinTimer();
            }
        }
        
        animate();
    }

    function updateHoldersList() {
        const holders = storage.get(STORAGE_KEYS.HOLDERS) || [];
        const holdersListDiv = document.getElementById('holdersList');
        const holdersCountSpan = document.getElementById('holdersCount');
        
        holdersCountSpan.textContent = holders.length;
        
        if (holders.length === 0) {
            holdersListDiv.innerHTML = '<p class="empty-message">No holders registered yet.</p>';
        } else {
            holdersListDiv.innerHTML = holders.map(address => 
                `<div class="address-item">${address}</div>`
            ).join('');
        }
        
        drawWheel(holders);
    }

    function updateWinnersList() {
        const winners = storage.get(STORAGE_KEYS.WINNERS) || [];
        const winnersListDiv = document.getElementById('winnersList');
        const winnersCountSpan = document.getElementById('winnersCount');
        
        winnersCountSpan.textContent = winners.length;
        
        if (winners.length === 0) {
            winnersListDiv.innerHTML = '<p class="empty-message">No winners yet.</p>';
        } else {
            winnersListDiv.innerHTML = winners.slice().reverse().map(winner => 
                `<div class="winner-item">
                    ${winner.address}
                    <span class="timestamp">${winner.spinTime}</span>
                </div>`
            ).join('');
        }
    }

    // Countdown timer for next spin
    function startAutoSpinTimer() {
        clearInterval(countdownTimer);
        
        countdownTimer = setInterval(() => {
            const lastSpin = storage.get(STORAGE_KEYS.LAST_SPIN) || 0;
            const now = Date.now();
            let diff = AUTO_SPIN_INTERVAL - (now - lastSpin);
            
            if (diff <= 0) {
                spinWheel();
                diff = AUTO_SPIN_INTERVAL;
            }
            
            const minutes = Math.floor(diff / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);
            countdownElement.textContent = `Next spin in: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }, 1000);
    }

    function initializeWheelPage() {
        if (!storage.get(STORAGE_KEYS.HOLDERS)) {
            storage.set(STORAGE_KEYS.HOLDERS, []);
        }
        if (!storage.get(STORAGE_KEYS.WINNERS)) {
            storage.set(STORAGE_KEYS.WINNERS, []);
        }
        if (!storage.get(STORAGE_KEYS.LAST_SPIN)) {
            storage.set(STORAGE_KEYS.LAST_SPIN, 0);
        }

        updateHoldersList();
        updateWinnersList();
        startAutoSpinTimer();

        spinButton.addEventListener('click', spinWheel);
    }

    initializeWheelPage();
}
