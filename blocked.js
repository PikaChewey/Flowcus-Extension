// Check if extension is enabled
chrome.storage.local.get({ extensionEnabled: true }, (result) => {
  const extensionEnabled = result.extensionEnabled;
  
  // If extension is disabled, show a message
  if (!extensionEnabled) {
    const message = document.querySelector('.message');
    const iconContainer = document.querySelector('.icon-container');
    const heading = document.querySelector('h1');
    const paragraph = document.querySelector('p');
    const timerSection = document.querySelector('.timer-section');
    
    // Update content
    iconContainer.innerHTML = `
      <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
      </svg>
    `;
    
    heading.textContent = "Extension Disabled";
    paragraph.textContent = "The Focus Flow extension is currently disabled. No websites are being blocked or tracked.";
    
    // Replace timer section with a button to open extension popup
    timerSection.innerHTML = `
      <div class="focus-tip">Click the button below to open the extension and turn it back on.</div>
      <button id="openExtensionBtn" class="back-button" style="background: var(--primary-light); color: white; margin-top: 15px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 15l-6-6-6 6"/>
        </svg>
        Open Extension
      </button>
    `;
    
    // Add event listener for the button
    document.getElementById('openExtensionBtn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: "OPEN_EXTENSION_POPUP" });
      window.history.back();
    });
  }
});

// Create floating particles
const particlesContainer = document.getElementById('particles');
const particleCount = 50;

for (let i = 0; i < particleCount; i++) {
  const particle = document.createElement('div');
  particle.classList.add('particle');
  
  // Random position
  const posX = Math.random() * 100;
  const posY = Math.random() * 100;
  
  // Random size
  const size = Math.random() * 4 + 2;
  
  // Random opacity
  const opacity = Math.random() * 0.3 + 0.1;
  
  // Apply styles
  particle.style.left = `${posX}%`;
  particle.style.top = `${posY}%`;
  particle.style.width = `${size}px`;
  particle.style.height = `${size}px`;
  particle.style.opacity = opacity;
  
  // Random animation
  const duration = Math.random() * 20 + 10;
  const delay = Math.random() * 5;
  
  particle.style.animation = `float${Math.random() > 0.5 ? '1' : '2'} ${duration}s ${delay}s ease-in-out infinite alternate`;
  
  particlesContainer.appendChild(particle);
}

// Display focus tips
const focusTips = [
  "Take a deep breath and redirect your attention to something meaningful.",
  "Remember why you set this block - your goals matter!",
  "One moment of discipline equals hours of accomplishment.",
  "What could you accomplish in the next 25 minutes?",
  "Small steps lead to big changes. Stay focused."
];

const focusTipElement = document.querySelector('.focus-tip');
let currentTipIndex = 0;

// Change focus tip every 8 seconds with a fade effect
setInterval(() => {
  currentTipIndex = (currentTipIndex + 1) % focusTips.length;
  focusTipElement.style.opacity = "0";
  setTimeout(() => {
    focusTipElement.textContent = focusTips[currentTipIndex];
    focusTipElement.style.opacity = "1";
  }, 500);
}, 8000);

// Simple timer display
function updateTimer() {
  const now = new Date();
  document.addEventListener('DOMContentLoaded', () => {
    const focusTimerEl = document.getElementById('focusTimer');
    if (focusTimerEl) {
      const now = new Date();
      focusTimerEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  });
}
document.getElementById('goBack').addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
});  

updateTimer();
setInterval(updateTimer, 1000);
