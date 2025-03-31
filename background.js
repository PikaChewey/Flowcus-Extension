
let extensionEnabled = true;

function trackUsage() {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (tabs.length === 0) return;
    const tab = tabs[0];
    if (!tab.url) return;
    try {
      const url = new URL(tab.url);
      const currentDomain = url.hostname;
      chrome.storage.local.get({ usageTime: {} }, (result) => {
        const usageTime = result.usageTime;
        usageTime[currentDomain] = (usageTime[currentDomain] || 0) + 1;
        chrome.storage.local.set({ usageTime });
        console.log(`Updated ${currentDomain}: ${usageTime[currentDomain]} seconds`);
      });
    } catch (e) {
      console.error("Error parsing URL:", e);
    }
  });
}

chrome.alarms.create("trackTime", { periodInMinutes: 1 / 60 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "trackTime") {
    trackUsage();
  }
});

// check
chrome.storage.local.get({ extensionEnabled: true }, (result) => {
  extensionEnabled = result.extensionEnabled;
  console.log(`Extension is ${extensionEnabled ? "enabled" : "disabled"} on startup`);
  if (!extensionEnabled) {
    removeAllBlockingRules();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // when disabled, certain msgs only
  if (
    !extensionEnabled &&
    message.type !== "SET_EXTENSION_ENABLED" &&
    message.type !== "OPEN_EXTENSION_POPUP"
  ) {
    return true;
  }

  switch (message.type) {
    case "SET_EXTENSION_ENABLED":
      extensionEnabled = message.enabled;
      chrome.storage.local.set({ extensionEnabled });
      console.log(`Extension ${extensionEnabled ? "enabled" : "disabled"}`);
      if (!extensionEnabled) {
        removeAllBlockingRules();
      } else {
        updateTimeBasedBlocking();
      }
      break;
    case "OPEN_EXTENSION_POPUP":
      chrome.action.openPopup();
      break;
    case "UNBLOCK_SITE":
      unblockSite(message.domain, message.ruleId);
      break;
    case "GET_ALL_RULES":
      getAllBlockRules().then((rules) => sendResponse(rules));
      return true; // indcate async rspnse
    case "UPDATE_BLOCK_SCHEDULE":
      updateBlockSchedule(message.domain, message.schedule);
      break;
    case "CHECK_BLOCK_TIME":
      checkBlockTimeForDomain(message.domain).then((shouldBlock) => {
        sendResponse({ shouldBlock });
      });
      return true;
    default:
      break;
  }
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log("Extension installed or updated");
  try {
    //static rules to dynamic (if exist in rules.json)
    await migrateStaticRulesToDynamic();
    const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
    if (blockedSites.length > 0) {
      await updateBlockRules(blockedSites);
    }
    // exist
    const { blockSchedules } = await chrome.storage.local.get("blockSchedules");
    if (!blockSchedules) {
      await chrome.storage.local.set({ blockSchedules: {} });
    }
    // daily reset alarm
    chrome.alarms.create("dailyReset", {
      when: getNextMidnight(),
      periodInMinutes: 24 * 60,
    });
    // check time-based blocking every minute
    chrome.alarms.create("checkTimeBlocking", { periodInMinutes: 1 });
  } catch (error) {
    console.error("Error during initialization:", error);
  }
});

// Listn for alarms for daily reset and time-based blocking
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "dailyReset") {
    await resetDailyStats();
  } else if (alarm.name === "checkTimeBlocking") {
    await updateTimeBasedBlocking();
  }
});

async function migrateStaticRulesToDynamic() {
  try {
    // Skip processng static rules
    console.log("Skipping migration of static rules");
    
    const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
    const { blockSchedules = {} } = await chrome.storage.local.get("blockSchedules");
    
    let needsSave = false;
    
    if (!blockedSites || blockedSites.length === 0) {
      needsSave = true;
    }
    
    if (!blockSchedules || Object.keys(blockSchedules).length === 0) {
      needsSave = true;
    }
    
    if (needsSave) {
      await chrome.storage.local.set({ 
        blockedSites: blockedSites || [], 
        blockSchedules: blockSchedules || {} 
      });
    }
    
    // Dont call with domains
    console.log("Extension initialized with no pre-blocked sites");
  } catch (error) {
    console.error("Error during initialization:", error);
  }
}

async function updateBlockRules(domains) {
  try {
    await updateActiveBlockRules(domains);
    const { blockSchedules = {} } = await chrome.storage.local.get("blockSchedules");
    let schedulesUpdated = false;
    for (const domain of domains) {
      if (!blockSchedules[domain]) {
        blockSchedules[domain] = {
          enabled: true,
          alwaysOn: true,
          startTime: "00:00",
          endTime: "23:59",
        };
        schedulesUpdated = true;
      }
    }
    if (schedulesUpdated) {
      await chrome.storage.local.set({ blockSchedules });
    }
    console.log(`Updated block rules for ${domains.length} domains`);
  } catch (error) {
    console.error("Error updating block rules:", error);
  }
}

async function updateActiveBlockRules(domains) {
  try {
    if (!extensionEnabled) {
      console.log("Extension disabled; skipping active block rule update");
      return;
    }
    // del all existing dynamic rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map((rule) => rule.id);
    if (existingRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRuleIds,
        addRules: [],
      });
    }
    // new rule if domains to block
    if (domains.length > 0) {
      const newRules = domains.map((domain, index) => ({
        id: index + 1,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { extensionPath: "/blocked.html" },
        },
        condition: {
          urlFilter: domain,
          resourceTypes: ["main_frame"],
        },
      }));
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [],
        addRules: newRules,
      });
      console.log(`Updated ${newRules.length} active blocking rules`);
    }
  } catch (error) {
    console.error("Error updating active blocking rules:", error);
  }
}

async function updateTimeBasedBlocking() {
  try {
    if (!extensionEnabled) {
      console.log("Extension disabled; skipping time-based blocking update");
      return;
    }
    const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
    const { blockSchedules = {} } = await chrome.storage.local.get("blockSchedules");
    
    const domainsToBlock = [];
    
    for (const domain of blockedSites) {
      const schedule = blockSchedules[domain];
      if (!schedule) continue;
      
      if (!schedule.enabled) continue;
      
      if (schedule.alwaysOn) {
        domainsToBlock.push(domain);
        continue;
      }
      
      //  if current time in  range
      const { timezone } = await chrome.storage.local.get({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      if (isTimeInRange(schedule.startTime, schedule.endTime, timezone)) {
        domainsToBlock.push(domain);
      }
    }
    
    await updateActiveBlockRules(domainsToBlock);
  } catch (error) {
    console.error("Error updating time-based blocking:", error);
  }
}

function isTimeInRange(startTime, endTime, timezone) {
  try {
    // Get currnt time in specfied timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    
    const currentTimeStr = formatter.format(now);
    
    // parse all time strigs to mins since midnight
    const parseTimeToMinutes = (timeStr) => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours * 60 + minutes;
    };
    
    const currentMinutes = parseTimeToMinutes(currentTimeStr);
    const startMinutes = parseTimeToMinutes(startTime);
    const endMinutes = parseTimeToMinutes(endTime);
    
    // curr time is in range
    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  } catch (error) {
    console.error("Error checking time range:", error);
    return false;
  }
}

async function checkBlockTimeForDomain(domain) {
  try {
    const { blockSchedules = {} } = await chrome.storage.local.get("blockSchedules");
    const schedule = blockSchedules[domain];
    
    if (!schedule || !schedule.enabled) return false;
    if (schedule.alwaysOn) return true;
    
    const { timezone } = await chrome.storage.local.get({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    return isTimeInRange(schedule.startTime, schedule.endTime, timezone);
  } catch (error) {
    console.error("Error checking block time for domain:", error);
    return false;
  }
}

async function updateBlockSchedule(domain, schedule) {
  try {
    const { blockSchedules = {} } = await chrome.storage.local.get("blockSchedules");
    
    blockSchedules[domain] = {
      ...schedule,
      enabled: true,
    };
    
    await chrome.storage.local.set({ blockSchedules });
    
    await updateTimeBasedBlocking();
    
    console.log(`Updated schedule for ${domain}:`, schedule);
  } catch (error) {
    console.error("Error updating block schedule:", error);
  }
}

async function getAllBlockRules() {
  try {
    const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
    const { blockSchedules = {} } = await chrome.storage.local.get("blockSchedules");
    const activeRules = await chrome.declarativeNetRequest.getDynamicRules();
    
    // map eaxh domnain to its rule + sched
    return blockedSites.map(domain => {
      const matchingRule = activeRules.find(rule => 
        rule.condition && rule.condition.urlFilter === domain
      );
      
      return {
        domain,
        ruleId: matchingRule ? matchingRule.id : null,
        isActive: !!matchingRule,
        schedule: blockSchedules[domain] || {
          enabled: true,
          alwaysOn: true, 
          startTime: "00:00",
          endTime: "23:59"
        }
      };
    });
  } catch (error) {
    console.error("Error getting all block rules:", error);
    return [];
  }
}

async function unblockSite(domain, ruleId) {
  try {
    const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
    const updatedBlockedSites = blockedSites.filter(site => site !== domain);
    await chrome.storage.local.set({ blockedSites: updatedBlockedSites });
    
    // remove spefcic dynaamic rule
    if (ruleId) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleId],
        addRules: []
      });
    }
    
    const { blockSchedules = {} } = await chrome.storage.local.get("blockSchedules");
    if (blockSchedules[domain]) {
      delete blockSchedules[domain];
      await chrome.storage.local.set({ blockSchedules });
    }
    
    console.log(`Unblocked site: ${domain}`);
  } catch (error) {
    console.error("Error unblocking site:", error);
  }
}

async function resetDailyStats() {
  try {
    // current
    const { usageTime = {} } = await chrome.storage.local.get("usageTime");
    const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD formt
    
    // store in history
    const { usageHistory = {} } = await chrome.storage.local.get("usageHistory");
    usageHistory[currentDate] = { ...usageTime };
    
    // 30 days max
    const dates = Object.keys(usageHistory).sort();
    if (dates.length > 30) {
      const datesToRemove = dates.slice(0, dates.length - 30);
      datesToRemove.forEach(date => {
        delete usageHistory[date];
      });
    }
    
    await chrome.storage.local.set({ 
      usageTime: {}, 
      usageHistory 
    });
    
    console.log("Daily stats reset and stored in history");
  } catch (error) {
    console.error("Error resetting daily stats:", error);
  }
}

function getNextMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

async function removeAllBlockingRules() {
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map(rule => rule.id);
    
    if (existingRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRuleIds,
        addRules: []
      });
      console.log("Removed all blocking rules");
    }
  } catch (error) {
    console.error("Error removing blocking rules:", error);
  }
}
