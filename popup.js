document.addEventListener('DOMContentLoaded', () => {
  let usageData = {}; // in seconds for each domain
  let currentDomain = "";
  let localTimerInterval;
  let blockedDomains = []; // To store list of blocked domains
  let blockSchedules = {}; // To store blocking schedules
  let extensionEnabled = true; // Track if extension is enabled
  
  // Initialize power toggle
  const powerToggle = document.getElementById('powerToggle');
  
  // Load extension enabled state
  chrome.storage.local.get({ extensionEnabled: true }, (result) => {
    extensionEnabled = result.extensionEnabled;
    powerToggle.checked = extensionEnabled;
    
    // Apply visual state to UI based on enabled/disabled
    updateExtensionEnabledState(extensionEnabled);
  });
  
  // Power toggle change event
  powerToggle.addEventListener('change', () => {
    extensionEnabled = powerToggle.checked;
    
    // Save to storage
    chrome.storage.local.set({ extensionEnabled: extensionEnabled }, () => {
      console.log(`Extension ${extensionEnabled ? 'enabled' : 'disabled'}`);
      
      // Notify background script about the state change
      chrome.runtime.sendMessage({ 
        type: "SET_EXTENSION_ENABLED", 
        enabled: extensionEnabled 
      });
      
      // Update UI based on new state
      updateExtensionEnabledState(extensionEnabled);
    });
  });
  
  // Function to update UI based on extension enabled state
  function updateExtensionEnabledState(enabled) {
    const container = document.body;
    const powerToggleLabel = document.querySelector('.power-toggle');
    
    if (enabled) {
      container.classList.remove('extension-disabled');
      powerToggleLabel.setAttribute('data-status', 'ON');
    } else {
      container.classList.add('extension-disabled');
      powerToggleLabel.setAttribute('data-status', 'OFF');
    }
    
    // Disable/enable inputs based on state
    const inputs = document.querySelectorAll('input:not(#powerToggle), button:not(#powerToggle), select');
    inputs.forEach(input => {
      input.disabled = !enabled;
    });
  }
  
  // Get the current active domain.
  function getCurrentDomain(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        try {
          const domain = new URL(tabs[0].url).hostname;
          callback(domain);
        } catch (e) {
          console.error("Error parsing URL:", e);
          callback(null);
        }
      } else {
        callback(null);
      }
    });
  }

  // Load initial usage data from storage.
  chrome.storage.local.get({ usageTime: {} }, (result) => {
    usageData = result.usageTime || {};
    getCurrentDomain((domain) => {
      if (domain) {
        currentDomain = domain;
        if (!usageData[currentDomain]) {
          usageData[currentDomain] = 0;
        }
      }
      updateUI();
      updateStatsUI();
      loadAllBlockRules(); // Load all blocking rules
      
      // Start the local timer that increments usage every second.
      localTimerInterval = setInterval(() => {
        getCurrentDomain((domain) => {
          if (!domain) return;
          // If the user switched tabs, update the current domain.
          if (domain !== currentDomain) {
            currentDomain = domain;
            if (!usageData[currentDomain]) {
              usageData[currentDomain] = 0;
            }
          }
          // Increment the usage for the current domain.
          usageData[currentDomain] += 1;
          updateUI();
          updateStatsUI();
          // Save our updated data.
          chrome.storage.local.set({ usageTime: usageData });
        });
      }, 1000);
      // Also poll storage every second for overall usage updates (for domains not active in this popup).
      setInterval(() => {
        chrome.storage.local.get({ usageTime: {} }, (result) => {
          const storedData = result.usageTime || {};
          // Merge stored data for all domains except the current one.
          for (const domain in storedData) {
            if (domain !== currentDomain) {
              usageData[domain] = storedData[domain];
            }
          }
          updateUI();
          updateStatsUI();
        });
      }, 1000);
    });
  });
  
  // Load timezone setting
  chrome.storage.local.get({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, (result) => {
    const timezone = result.timezone;
    
    // Setup timezone selector
    const timezoneSelector = document.getElementById('timezoneSelector');
    if (timezoneSelector) {
      // Define standard timezone options
      const timezoneOptions = [
        { value: 'UTC', label: 'UTC' },
        { value: 'America/New_York', label: 'EST (UTC-5)' },
        { value: 'America/Chicago', label: 'CST (UTC-6)' },
        { value: 'America/Denver', label: 'MST (UTC-7)' },
        { value: 'America/Los_Angeles', label: 'PST (UTC-8)' },
        { value: 'America/Anchorage', label: 'AKST (UTC-9)' },
        { value: 'Pacific/Honolulu', label: 'HST (UTC-10)' },
        { value: 'Europe/London', label: 'GMT (UTC+0)' },
        { value: 'Europe/Paris', label: 'CET (UTC+1)' },
        { value: 'Europe/Athens', label: 'EET (UTC+2)' },
        { value: 'Asia/Dubai', label: 'GST (UTC+4)' },
        { value: 'Asia/Kolkata', label: 'IST (UTC+5:30)' },
        { value: 'Asia/Shanghai', label: 'CST (UTC+8)' },
        { value: 'Asia/Tokyo', label: 'JST (UTC+9)' },
        { value: 'Australia/Sydney', label: 'AEST (UTC+10)' },
        { value: 'Pacific/Auckland', label: 'NZDT (UTC+12)' }
      ];
      
      // Create options for each timezone
      timezoneOptions.forEach(tz => {
        const option = document.createElement('option');
        option.value = tz.value;
        option.textContent = tz.label;
        option.selected = tz.value === timezone;
        timezoneSelector.appendChild(option);
      });
      
      // Listen for changes
      timezoneSelector.addEventListener('change', () => {
        const newTimezone = timezoneSelector.value;
        chrome.storage.local.set({ timezone: newTimezone }, () => {
          console.log('Timezone updated to', newTimezone);
        });
      });
    }
  });
  
  // Load all block rules from the background script
  function loadAllBlockRules() {
    chrome.runtime.sendMessage({ type: "GET_ALL_RULES" }, (rules) => {
      if (!rules) {
        console.error("Failed to get block rules");
        return;
      }
      
      // Store the rules
      blockedDomains = rules.map(rule => rule.domain);
      
      // Store the schedules
      blockSchedules = {};
      rules.forEach(rule => {
        blockSchedules[rule.domain] = rule.schedule;
      });
      
      // Update the block list UI
      updateBlockList(rules);
    });
  }

  // Function to update stats UI with total time and unique sites
  function updateStatsUI() {
    // Calculate total screen time
    let totalSeconds = 0;
    for (const domain in usageData) {
      totalSeconds += usageData[domain];
    }
    
    // Format total time
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const formattedTime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    
    // Count unique sites
    const uniqueSites = Object.keys(usageData).length;
    
    // Update the UI
    document.getElementById('totalScreenTime').textContent = formattedTime;
    document.getElementById('sitesVisited').textContent = uniqueSites;
    
    // Update website details dropdown
    updateWebsiteDetails();
  }
  
  // Update website details in the dropdown
  function updateWebsiteDetails() {
    const dropdown = document.getElementById('websiteDetailsDropdown');
    
    // Sort domains by usage (highest first)
    const sortedDomains = Object.keys(usageData).sort((a, b) => {
      return usageData[b] - usageData[a];
    });
    
    if (sortedDomains.length === 0) {
      dropdown.innerHTML = `
        <div class="site-usage-item">
          <span class="site-usage-domain">No website data available</span>
          <span class="site-usage-time"></span>
        </div>
      `;
      return;
    }
    
    let html = '';
    sortedDomains.forEach(domain => {
      const seconds = usageData[domain];
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      
      let timeText = '';
      if (hours > 0) {
        timeText = `${hours}h ${remainingMinutes}m`;
      } else {
        timeText = `${minutes}m`;
      }
      
      html += `
        <div class="site-usage-item">
          <span class="site-usage-domain">${domain}</span>
          <span class="site-usage-time">${timeText}</span>
        </div>
      `;
    });
    
    dropdown.innerHTML = html;
  }

  function updateUI() {
    // Update the current site display.
    const currentSeconds = usageData[currentDomain] || 0;
    const currentSiteDiv = document.getElementById('currentSite');
    const currentMins = Math.floor(currentSeconds / 60);
    const currentSecs = currentSeconds % 60;
    currentSiteDiv.innerHTML = `<p>Current Active Site: <strong>${currentDomain}</strong></p>
                                <p>Time Spent: <strong>${currentMins}m ${currentSecs}s</strong></p>`;
  }

  // --- Blocking Functionality ---

  const blockBtn = document.getElementById('blockBtn');
  blockBtn.addEventListener('click', () => {
    const domainInput = document.getElementById('blockSite');
    const domain = domainInput.value.trim();
    const errorMessage = document.getElementById('errorMessage');
    
    if (!domain) {
      showError("Please enter a domain to block.");
      return;
    }
    
    // Remove protocol and www if present.
    let formattedDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, "");
    
    // Check if domain is already blocked
    if (isDomainBlocked(formattedDomain)) {
      showError("This website has already been blocked and cannot be blocked again.");
      return;
    }
    
    const ruleId = Math.floor(Math.random() * 1000) + 1;
    const rule = {
      id: ruleId,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: "/blocked.html" }
      },
      condition: {
        urlFilter: formattedDomain,
        resourceTypes: ["main_frame"]
      }
    };
    
    chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [rule],
      removeRuleIds: []
    }, () => {
      if (chrome.runtime.lastError) {
        console.error("Error updating dynamic rules:", chrome.runtime.lastError);
        showError("Failed to block the domain. Please try again.");
      } else {
        console.log(`Domain ${formattedDomain} blocked with rule id ${ruleId}`);
        
        // Store the blocked domain in persistent storage
        chrome.storage.local.get({ blockedSites: [] }, (result) => {
          const blockedSites = result.blockedSites || [];
          if (!blockedSites.includes(formattedDomain)) {
            blockedSites.push(formattedDomain);
            chrome.storage.local.set({ blockedSites: blockedSites }, () => {
              console.log(`Added ${formattedDomain} to blocked sites storage`);
              
              // Initialize block schedule (always on by default)
              chrome.storage.local.get({ blockSchedules: {} }, (result) => {
                const schedules = result.blockSchedules || {};
                schedules[formattedDomain] = {
                  enabled: true,
                  alwaysOn: true,
                  startTime: "00:00",
                  endTime: "23:59"
                };
                chrome.storage.local.set({ blockSchedules: schedules }, () => {
                  console.log(`Added schedule for ${formattedDomain}`);
                  
                  // Reload block rules to update UI
                  loadAllBlockRules();
                });
              });
            });
          }
        });
        
        // Hide error message if it was visible
        errorMessage.classList.remove('active');
        domainInput.value = '';
      }
    });
  });
  
  // Show error message
  function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    errorMessage.textContent = message;
    errorMessage.classList.add('active');
    
    // Hide error after 5 seconds
    setTimeout(() => {
      errorMessage.classList.remove('active');
    }, 5000);
  }
  
  // Check if a domain is already blocked
  function isDomainBlocked(domain) {
    return blockedDomains.some(blockedDomain => {
      return domain.includes(blockedDomain) || blockedDomain.includes(domain);
    });
  }
  
  // Handle time picker changes
  function handleTimeChange(domain, isStart, value) {
    if (!blockSchedules[domain]) return;
    
    const schedule = blockSchedules[domain];
    
    if (isStart) {
      schedule.startTime = value;
    } else {
      schedule.endTime = value;
    }
    
    // Update the schedule in storage and background script
    chrome.runtime.sendMessage({
      type: "UPDATE_BLOCK_SCHEDULE",
      domain: domain,
      schedule: schedule
    });
    
    console.log(`Updated ${isStart ? "start" : "end"} time for ${domain} to ${value}`);
  }
  
  // Handle always on toggle
  function handleAlwaysOnToggle(domain, value) {
    if (!blockSchedules[domain]) return;
    
    const schedule = blockSchedules[domain];
    schedule.alwaysOn = value;
    
    // If turning always on, hide time inputs
    const timeInputs = document.querySelectorAll(`.time-inputs[data-domain="${domain}"]`);
    timeInputs.forEach(el => {
      el.style.display = value ? 'none' : 'flex';
    });
    
    // Update the schedule in storage and background script
    chrome.runtime.sendMessage({
      type: "UPDATE_BLOCK_SCHEDULE",
      domain: domain,
      schedule: schedule
    });
    
    console.log(`Updated always on setting for ${domain} to ${value}`);
  }

  // --- Active Block List Functionality ---
  function updateBlockList(rules) {
    const blockListDiv = document.getElementById('activeBlockList');
    
    if (!rules || rules.length === 0) {
      blockListDiv.innerHTML = `<div class="empty-list">No websites blocked yet.</div>`;
      return;
    }
    
    let html = `
      <div class="timezone-container">
        <label for="timezoneSelector">Your timezone:</label>
        <select id="timezoneSelector" class="timezone-selector"></select>
      </div>
    `;
    
    rules.forEach(rule => {
      const domain = rule.domain;
      const ruleId = rule.ruleId;
      const schedule = rule.schedule || {
        enabled: true,
        alwaysOn: true,
        startTime: "00:00",
        endTime: "23:59"
      };
      
      // Store schedule
      blockSchedules[domain] = schedule;
      
      // Format the time for display
      const startTime = formatTimeForDisplay(schedule.startTime);
      const endTime = formatTimeForDisplay(schedule.endTime);
      
      html += `
        <div class="site-entry">
          <div class="site-header">
            <span class="site-url">${domain}</span>
            <button class="unblock-btn" data-ruleid="${ruleId}" data-domain="${domain}">Unblock</button>
          </div>
          
          <div class="block-schedule">
            <label class="always-on-label">
              <input type="checkbox" class="always-on-checkbox" data-domain="${domain}" 
              ${schedule.alwaysOn ? 'checked' : ''}>
              Always blocked
            </label>
            
            <div class="time-inputs" data-domain="${domain}" style="${schedule.alwaysOn ? 'display:none;' : ''}">
              <div class="time-input-group">
                <span>From:</span>
                <input type="time" class="time-input start-time" data-domain="${domain}" value="${schedule.startTime}">
              </div>
              <div class="time-input-group">
                <span>To:</span>
                <input type="time" class="time-input end-time" data-domain="${domain}" value="${schedule.endTime}">
              </div>
            </div>
          </div>
        </div>
      `;
    });
    
    blockListDiv.innerHTML = html;
    
    // Setup timezone selector again (it was just recreated)
    chrome.storage.local.get({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, (result) => {
      const timezone = result.timezone;
      
      // Setup timezone selector
      const timezoneSelector = document.getElementById('timezoneSelector');
      if (timezoneSelector) {
        // Define standard timezone options
        const timezoneOptions = [
          { value: 'UTC', label: 'UTC' },
          { value: 'America/New_York', label: 'EST (UTC-5)' },
          { value: 'America/Chicago', label: 'CST (UTC-6)' },
          { value: 'America/Denver', label: 'MST (UTC-7)' },
          { value: 'America/Los_Angeles', label: 'PST (UTC-8)' },
          { value: 'America/Anchorage', label: 'AKST (UTC-9)' },
          { value: 'Pacific/Honolulu', label: 'HST (UTC-10)' },
          { value: 'Europe/London', label: 'GMT (UTC+0)' },
          { value: 'Europe/Paris', label: 'CET (UTC+1)' },
          { value: 'Europe/Athens', label: 'EET (UTC+2)' },
          { value: 'Asia/Dubai', label: 'GST (UTC+4)' },
          { value: 'Asia/Kolkata', label: 'IST (UTC+5:30)' },
          { value: 'Asia/Shanghai', label: 'CST (UTC+8)' },
          { value: 'Asia/Tokyo', label: 'JST (UTC+9)' },
          { value: 'Australia/Sydney', label: 'AEST (UTC+10)' },
          { value: 'Pacific/Auckland', label: 'NZDT (UTC+12)' }
        ];
        
        // Clear existing options
        timezoneSelector.innerHTML = '';
        
        // Create options for each timezone
        timezoneOptions.forEach(tz => {
          const option = document.createElement('option');
          option.value = tz.value;
          option.textContent = tz.label;
          option.selected = tz.value === timezone;
          timezoneSelector.appendChild(option);
        });
        
        // Listen for changes
        timezoneSelector.addEventListener('change', () => {
          const newTimezone = timezoneSelector.value;
          chrome.storage.local.set({ timezone: newTimezone }, () => {
            console.log('Timezone updated to', newTimezone);
          });
        });
      }
    });

    // Attach event listeners for each unblock button.
    document.querySelectorAll('.unblock-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const ruleId = parseInt(this.getAttribute('data-ruleid'));
        const domain = this.getAttribute('data-domain');
        
        // Send message to background script to unblock site
        chrome.runtime.sendMessage({
          type: "UNBLOCK_SITE",
          domain: domain,
          ruleId: ruleId
        });
        
        // Update UI immediately
        blockedDomains = blockedDomains.filter(site => site !== domain);
        delete blockSchedules[domain];
        
        // Reload block rules to update UI
        setTimeout(loadAllBlockRules, 500);
      });
    });
    
    // Attach listeners for time inputs
    document.querySelectorAll('.time-input').forEach(input => {
      input.addEventListener('change', function() {
        const domain = this.getAttribute('data-domain');
        const isStart = this.classList.contains('start-time');
        handleTimeChange(domain, isStart, this.value);
      });
    });
    
    // Attach listeners for always on checkbox
    document.querySelectorAll('.always-on-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', function() {
        const domain = this.getAttribute('data-domain');
        handleAlwaysOnToggle(domain, this.checked);
      });
    });

    // Initialize the cursor-following effects
    initCursorFollowEffects();
  }
  
  // Format time for display (HH:MM to HH:MM AM/PM)
  function formatTimeForDisplay(timeString) {
    if (!timeString) return "00:00";
    
    try {
      const [hours, minutes] = timeString.split(':').map(Number);
      
      // Return the original format for the time input
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    } catch (error) {
      console.error("Error formatting time:", error);
      return "00:00";
    }
  }
  
  // Toggle website details dropdown
  const moreDetailsBtn = document.getElementById('moreDetailsBtn');
  const websiteDetailsDropdown = document.getElementById('websiteDetailsDropdown');
  
  moreDetailsBtn.addEventListener('click', () => {
    websiteDetailsDropdown.classList.toggle('active');
    moreDetailsBtn.textContent = websiteDetailsDropdown.classList.contains('active') 
      ? 'Hide Details' 
      : 'More Details';
  });

  // Helper function to initialize cursor-following hover effects
  function initCursorFollowEffects() {
    // Select all unblock buttons
    document.querySelectorAll('.unblock-btn').forEach(btn => {
      // Create and append the hover effect element
      const hoverEffect = document.createElement('span');
      hoverEffect.className = 'hover-effect';
      btn.appendChild(hoverEffect);
      
      // Add mousemove event listener
      btn.addEventListener('mousemove', function(e) {
        // Calculate cursor position relative to the button
        const rect = this.getBoundingClientRect();
        const x = e.clientX - rect.left; // x position within the button
        const y = e.clientY - rect.top;  // y position within the button
        
        // Update the radial gradient position to follow the cursor
        const effect = this.querySelector('.hover-effect');
        effect.style.backgroundPosition = `${x}px ${y}px`;
      });
    });
  }
});
