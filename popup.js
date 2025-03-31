document.addEventListener('DOMContentLoaded', () => {
  let usageData = {}; // seconds per domain
  let currentDomain = "";
  let localTimerInterval;
  let blockedDomains = []; // list of blocked domains
  let blockSchedules = {}; // schedules for blocks
  let extensionEnabled = true; // track enabled state
  
  const powerToggle = document.getElementById('powerToggle');
  
  chrome.storage.local.get({ extensionEnabled: true }, (result) => {
    extensionEnabled = result.extensionEnabled;
    powerToggle.checked = extensionEnabled;
    
    updateExtensionEnabledState(extensionEnabled);
  });
  
  powerToggle.addEventListener('change', () => {
    extensionEnabled = powerToggle.checked;
    
    chrome.storage.local.set({ extensionEnabled: extensionEnabled }, () => {
      console.log(`Extension ${extensionEnabled ? 'enabled' : 'disabled'}`);
      
      chrome.runtime.sendMessage({ 
        type: "SET_EXTENSION_ENABLED", 
        enabled: extensionEnabled 
      });
      
      updateExtensionEnabledState(extensionEnabled);
    });
  });
  
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
    
    const inputs = document.querySelectorAll('input:not(#powerToggle), button:not(#powerToggle), select');
    inputs.forEach(input => {
      input.disabled = !enabled;
    });
  }
  
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
      loadAllBlockRules();
      
      // Start local timer that increments usage evry sec
      localTimerInterval = setInterval(() => {
        getCurrentDomain((domain) => {
          if (!domain) return;
          if (domain !== currentDomain) {
            currentDomain = domain;
            if (!usageData[currentDomain]) {
              usageData[currentDomain] = 0;
            }
          }
          usageData[currentDomain] += 1;
          updateUI();
          updateStatsUI();
          chrome.storage.local.set({ usageTime: usageData });
        });
      }, 1000);
      
      // Poll storage for usage updates from other tabs
      setInterval(() => {
        chrome.storage.local.get({ usageTime: {} }, (result) => {
          const storedData = result.usageTime || {};
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
  
  chrome.storage.local.get({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, (result) => {
    const timezone = result.timezone;
    
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
      
      timezoneOptions.forEach(tz => {
        const option = document.createElement('option');
        option.value = tz.value;
        option.textContent = tz.label;
        option.selected = tz.value === timezone;
        timezoneSelector.appendChild(option);
      });
      
      timezoneSelector.addEventListener('change', () => {
        const newTimezone = timezoneSelector.value;
        chrome.storage.local.set({ timezone: newTimezone }, () => {
          console.log('Timezone updated to', newTimezone);
        });
      });
    }
  });
  
  function loadAllBlockRules() {
    chrome.runtime.sendMessage({ type: "GET_ALL_RULES" }, (rules) => {
      if (!rules) {
        console.error("Failed to get block rules");
        return;
      }
      
      blockedDomains = rules.map(rule => rule.domain);
      
      blockSchedules = {};
      rules.forEach(rule => {
        blockSchedules[rule.domain] = rule.schedule;
      });
      
      updateBlockList(rules);
    });
  }

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
    
    const uniqueSites = Object.keys(usageData).length;
    
    document.getElementById('totalScreenTime').textContent = formattedTime;
    document.getElementById('sitesVisited').textContent = uniqueSites;
    
    updateWebsiteDetails();
  }
  
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
      
      const isBlocked = blockedDomains.includes(domain);
      
      html += `
        <div class="site-usage-item ${isBlocked ? 'blocked-site' : ''}">
          <span class="site-usage-domain">${domain}</span>
          <span class="site-usage-time">${timeText}</span>
          ${isBlocked ? '<span class="blocked-badge">Blocked</span>' : ''}
        </div>
      `;
    });
    
    dropdown.innerHTML = html;
  }

  function updateUI() {
    getCurrentDomain((domain) => {
      if (!domain) {
        document.getElementById('currentDomain').textContent = 'No active website';
        document.getElementById('currentDomainTime').textContent = '0m';
        document.getElementById('domainActions').style.display = 'none';
        return;
      }
      
      const currentDomain = domain;
      document.getElementById('currentDomain').textContent = currentDomain;
      
      const seconds = usageData[currentDomain] || 0;
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      
      let timeText = '';
      if (hours > 0) {
        timeText = `${hours}h ${remainingMinutes}m`;
      } else {
        timeText = `${minutes}m`;
      }
      document.getElementById('currentDomainTime').textContent = timeText;
      
      document.getElementById('domainActions').style.display = 'flex';
      
      const blockButton = document.getElementById('blockSiteButton');
      const unblockButton = document.getElementById('unblockSiteButton');
      const scheduleSettings = document.getElementById('scheduleSettings');
      
      const isBlocked = isDomainBlocked(currentDomain);
      
      if (isBlocked) {
        blockButton.style.display = 'none';
        unblockButton.style.display = 'block';
        scheduleSettings.style.display = 'block';
        
        const schedule = blockSchedules[currentDomain] || {
          enabled: true,
          alwaysOn: true,
          startTime: '00:00',
          endTime: '23:59'
        };
        
        const alwaysOnToggle = document.getElementById('alwaysOnToggle');
        const startTimeInput = document.getElementById('startTimeInput');
        const endTimeInput = document.getElementById('endTimeInput');
        
        alwaysOnToggle.checked = schedule.alwaysOn;
        startTimeInput.value = schedule.startTime;
        endTimeInput.value = schedule.endTime;
        
        startTimeInput.disabled = schedule.alwaysOn;
        endTimeInput.disabled = schedule.alwaysOn;
      } else {
        blockButton.style.display = 'block';
        unblockButton.style.display = 'none';
        scheduleSettings.style.display = 'none';
      }
      
      blockButton.onclick = async () => {
        try {
          const { blockedSites = [] } = await new Promise(resolve => {
            chrome.storage.local.get({ blockedSites: [] }, resolve);
          });
          
          if (!blockedSites.includes(currentDomain)) {
            blockedSites.push(currentDomain);
            await new Promise(resolve => {
              chrome.storage.local.set({ blockedSites }, resolve);
            });
            
            chrome.runtime.sendMessage({ 
              type: "UPDATE_BLOCK_SCHEDULE", 
              domain: currentDomain,
              schedule: {
                enabled: true,
                alwaysOn: true,
                startTime: '00:00',
                endTime: '23:59'
              }
            });
            
            loadAllBlockRules();
          }
        } catch (error) {
          showError('Failed to block site');
          console.error(error);
        }
      };
      
      unblockButton.onclick = () => {
        chrome.runtime.sendMessage({ type: "GET_ALL_RULES" }, (rules) => {
          const domainRule = rules.find(rule => rule.domain === currentDomain);
          if (domainRule) {
            chrome.runtime.sendMessage({ 
              type: "UNBLOCK_SITE", 
              domain: currentDomain,
              ruleId: domainRule.ruleId
            });
            
            loadAllBlockRules();
          }
        });
      };
    });
  }

  function showError(message) {
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    document.body.appendChild(errorElement);
    
    // Remove after 3 seconds
    setTimeout(() => {
      errorElement.classList.add('fade-out');
      setTimeout(() => errorElement.remove(), 500);
    }, 3000);
  }
  
  function isDomainBlocked(domain) {
    return blockedDomains.includes(domain);
  }
  
  function handleTimeChange(domain, isStart, value) {
    if (!domain || !blockSchedules[domain]) return;
    
    const schedule = blockSchedules[domain];
    if (isStart) {
      schedule.startTime = value;
    } else {
      schedule.endTime = value;
    }
    
    chrome.runtime.sendMessage({
      type: "UPDATE_BLOCK_SCHEDULE",
      domain,
      schedule
    });
  }
  
  function handleAlwaysOnToggle(domain, value) {
    if (!domain || !blockSchedules[domain]) return;
    
    const schedule = blockSchedules[domain];
    schedule.alwaysOn = value;
    
    const startTimeInput = document.getElementById('startTimeInput');
    const endTimeInput = document.getElementById('endTimeInput');
    
    startTimeInput.disabled = value;
    endTimeInput.disabled = value;
    
    chrome.runtime.sendMessage({
      type: "UPDATE_BLOCK_SCHEDULE",
      domain,
      schedule
    });
  }

  function updateBlockList(rules) {
    const blockedSitesContainer = document.getElementById('blockedSitesContainer');
    if (!blockedSitesContainer) return;
    
    blockedSitesContainer.innerHTML = '';
    
    if (!rules || rules.length === 0) {
      blockedSitesContainer.innerHTML = `
        <div class="no-sites-message">
          <p>No sites are currently blocked.</p>
          <p>To block a site, navigate to it and click "Block This Site".</p>
        </div>
      `;
      return;
    }
    
    const titleElement = document.createElement('h3');
    titleElement.textContent = 'Blocked Sites';
    titleElement.className = 'blocked-sites-title';
    blockedSitesContainer.appendChild(titleElement);
    
    const sitesList = document.createElement('div');
    sitesList.className = 'blocked-sites-list';
    
    // Sort by domain name
    const sortedRules = [...rules].sort((a, b) => a.domain.localeCompare(b.domain));
    
    sortedRules.forEach(rule => {
      const { domain, ruleId, schedule } = rule;
      
      const siteItem = document.createElement('div');
      siteItem.className = 'blocked-site-item';
      
      const domainInfo = document.createElement('div');
      domainInfo.className = 'domain-info';
      
      const domainName = document.createElement('span');
      domainName.className = 'domain-name';
      domainName.textContent = domain;
      
      const statusBadge = document.createElement('span');
      statusBadge.className = `status-badge ${rule.isActive ? 'active' : 'inactive'}`;
      statusBadge.textContent = rule.isActive ? 'Active' : 'Inactive';
      
      domainInfo.appendChild(domainName);
      domainInfo.appendChild(statusBadge);
      
      const scheduleControls = document.createElement('div');
      scheduleControls.className = 'schedule-controls';
      
      const alwaysOnLabel = document.createElement('label');
      alwaysOnLabel.className = 'toggle-label';
      alwaysOnLabel.innerHTML = `
        <input type="checkbox" class="always-on-toggle" ${schedule.alwaysOn ? 'checked' : ''}>
        <span class="toggle-slider"></span>
        <span class="toggle-text">Always Blocked</span>
      `;
      
      const timeRangeControls = document.createElement('div');
      timeRangeControls.className = 'time-range-controls';
      timeRangeControls.style.display = schedule.alwaysOn ? 'none' : 'flex';
      
      const startTimeInput = document.createElement('input');
      startTimeInput.type = 'time';
      startTimeInput.className = 'time-input start-time';
      startTimeInput.value = schedule.startTime || '00:00';
      
      const timeRangeSeparator = document.createElement('span');
      timeRangeSeparator.className = 'time-range-separator';
      timeRangeSeparator.textContent = 'to';
      
      const endTimeInput = document.createElement('input');
      endTimeInput.type = 'time';
      endTimeInput.className = 'time-input end-time';
      endTimeInput.value = schedule.endTime || '23:59';
      
      timeRangeControls.appendChild(startTimeInput);
      timeRangeControls.appendChild(timeRangeSeparator);
      timeRangeControls.appendChild(endTimeInput);
      
      const unblockButton = document.createElement('button');
      unblockButton.className = 'unblock-button';
      unblockButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="trash-icon">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;
      
      const alwaysOnToggle = alwaysOnLabel.querySelector('input');
      alwaysOnToggle.addEventListener('change', () => {
        const isAlwaysOn = alwaysOnToggle.checked;
        timeRangeControls.style.display = isAlwaysOn ? 'none' : 'flex';
        
        schedule.alwaysOn = isAlwaysOn;
        chrome.runtime.sendMessage({
          type: "UPDATE_BLOCK_SCHEDULE",
          domain,
          schedule
        });
      });
      
      startTimeInput.addEventListener('change', () => {
        schedule.startTime = startTimeInput.value;
        chrome.runtime.sendMessage({
          type: "UPDATE_BLOCK_SCHEDULE",
          domain,
          schedule
        });
      });
      
      endTimeInput.addEventListener('change', () => {
        schedule.endTime = endTimeInput.value;
        chrome.runtime.sendMessage({
          type: "UPDATE_BLOCK_SCHEDULE",
          domain,
          schedule
        });
      });
      
      unblockButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          type: "UNBLOCK_SITE",
          domain,
          ruleId
        });
        
        siteItem.remove();
        
        if (blockedSitesContainer.querySelectorAll('.blocked-site-item').length === 0) {
          updateBlockList([]);
        }
      });
      
      scheduleControls.appendChild(alwaysOnLabel);
      scheduleControls.appendChild(timeRangeControls);
      
      siteItem.appendChild(domainInfo);
      siteItem.appendChild(scheduleControls);
      siteItem.appendChild(unblockButton);
      
      sitesList.appendChild(siteItem);
    });
    
    blockedSitesContainer.appendChild(sitesList);
  }
  
  function formatTimeForDisplay(timeString) {
    if (!timeString) return '';
    
    const [hours, minutes] = timeString.split(':').map(Number);
    
    let period = 'AM';
    let hours12 = hours;
    
    if (hours >= 12) {
      period = 'PM';
      hours12 = hours === 12 ? 12 : hours - 12;
    }
    
    if (hours12 === 0) {
      hours12 = 12;
    }
    
    // Pad minutes with leading zero if needed
    const paddedMinutes = minutes < 10 ? `0${minutes}` : minutes;
    
    return `${hours12}:${paddedMinutes} ${period}`;
  }
  
  const moreDetailsBtn = document.getElementById('moreDetailsBtn');
  const websiteDetailsDropdown = document.getElementById('websiteDetailsDropdown');
  
  moreDetailsBtn.addEventListener('click', () => {
    websiteDetailsDropdown.classList.toggle('active');
    moreDetailsBtn.textContent = websiteDetailsDropdown.classList.contains('active') 
      ? 'Hide Details' 
      : 'More Details';
  });

  function initCursorFollowEffects() {
    const cursor = document.createElement('div');
    cursor.className = 'custom-cursor';
    document.body.appendChild(cursor);
    
    const cursorHighlight = document.createElement('div');
    cursorHighlight.className = 'cursor-highlight';
    document.body.appendChild(cursorHighlight);
    
    document.addEventListener('mousemove', (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
      
      // Delay the highlight a bit for cool effect
      setTimeout(() => {
        cursorHighlight.style.left = `${e.clientX}px`;
        cursorHighlight.style.top = `${e.clientY}px`;
      }, 100);
    });
    
    const interactiveElements = document.querySelectorAll('button, a, .toggle-slider, input[type="checkbox"], select');
    
    interactiveElements.forEach((elem) => {
      elem.addEventListener('mouseenter', () => {
        cursor.classList.add('cursor-active');
        cursorHighlight.classList.add('highlight-active');
      });
      
      elem.addEventListener('mouseleave', () => {
        cursor.classList.remove('cursor-active');
        cursorHighlight.classList.remove('highlight-active');
      });
    });
  }

  getCurrentDomain((domain) => {
    if (domain) {
      currentDomain = domain;
    }
    updateUI();
  });
  
  initCursorFollowEffects();
  
  document.getElementById('startTimeInput')?.addEventListener('change', (e) => {
    getCurrentDomain((domain) => {
      if (domain) {
        handleTimeChange(domain, true, e.target.value);
      }
    });
  });
  
  document.getElementById('endTimeInput')?.addEventListener('change', (e) => {
    getCurrentDomain((domain) => {
      if (domain) {
        handleTimeChange(domain, false, e.target.value);
      }
    });
  });
  
  document.getElementById('alwaysOnToggle')?.addEventListener('change', (e) => {
    getCurrentDomain((domain) => {
      if (domain) {
        handleAlwaysOnToggle(domain, e.target.checked);
      }
    });
  });
});
