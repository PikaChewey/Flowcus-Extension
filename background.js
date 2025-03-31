// background.js

// Global extension state
let extensionEnabled = true; // default enabled

// --------------------
// USAGE TRACKING LOGIC
// --------------------

// Instead of storing currentDomain globally (which can be lost when the service worker is killed),
// we query the active tab each time the alarm fires.
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

// Create a single alarm for tracking usage roughly every second.
chrome.alarms.create("trackTime", { periodInMinutes: 1 / 60 });

// Alarm listener for usage tracking
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "trackTime") {
    trackUsage();
  }
});

// --------------------
// EXTENSION STATE & MESSAGE HANDLING
// --------------------

// Check extension enabled state on startup
chrome.storage.local.get({ extensionEnabled: true }, (result) => {
  extensionEnabled = result.extensionEnabled;
  console.log(`Extension is ${extensionEnabled ? "enabled" : "disabled"} on startup`);
  if (!extensionEnabled) {
    removeAllBlockingRules();
  }
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // When extension is disabled, only allow certain messages.
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
      return true; // Indicate async response.
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

// --------------------
// INITIALIZATION & ALARMS
// --------------------

// onInstalled: run initialization logic
chrome.runtime.onInstalled.addListener(async () => {
  console.log("Extension installed or updated");
  try {
    // Migrate static rules to dynamic rules (if any exist in rules.json)
    await migrateStaticRulesToDynamic();
    const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
    if (blockedSites.length > 0) {
      await updateBlockRules(blockedSites);
    }
    // Ensure blockSchedules storage exists
    const { blockSchedules } = await chrome.storage.local.get("blockSchedules");
    if (!blockSchedules) {
      await chrome.storage.local.set({ blockSchedules: {} });
    }
    // Create daily reset alarm (runs at next midnight, then every 24 hours)
    chrome.alarms.create("dailyReset", {
      when: getNextMidnight(),
      periodInMinutes: 24 * 60,
    });
    // Create an alarm to check time-based blocking every minute
    chrome.alarms.create("checkTimeBlocking", { periodInMinutes: 1 });
  } catch (error) {
    console.error("Error during initialization:", error);
  }
});

// Listen for alarms for daily reset and time-based blocking
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "dailyReset") {
    await resetDailyStats();
  } else if (alarm.name === "checkTimeBlocking") {
    await updateTimeBasedBlocking();
  }
});

// --------------------
// BLOCKING & SCHEDULING LOGIC
// --------------------

// Modify this function in background.js
async function migrateStaticRulesToDynamic() {
  try {
    // Skip processing the static rules
    console.log("Skipping migration of static rules");
    
    // Just initialize empty storage objects
    const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
    const { blockSchedules = {} } = await chrome.storage.local.get("blockSchedules");
    
    // Only save if something is missing (don't overwrite existing user data)
    let needsSave = false;
    
    if (!blockedSites || blockedSites.length === 0) {
      // Initialize with empty array instead of using static rules
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
    
    // Don't call updateBlockRules with any domains
    console.log("Extension initialized with no pre-blocked sites");
  } catch (error) {
    console.error("Error during initialization:", error);
  }
}

// Update blocking rules for a list of domains.
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

// Update active blocking rules based on current domains that should be blocked.
async function updateActiveBlockRules(domains) {
  try {
    if (!extensionEnabled) {
      console.log("Extension disabled; skipping active block rule update");
      return;
    }
    // Remove all existing dynamic rules.
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map((rule) => rule.id);
    if (existingRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRuleIds,
        addRules: [],
      });
    }
    // Add new rules if there are any domains to block.
    if (domains.length > 0) {
      const newRules = domains.map((domain, index) => ({
        id: index + 1, // Rule IDs must be positive integers
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

// Update time-based blocking rules based on schedules.
async function updateTimeBasedBlocking() {
  try {
    const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
    const { blockSchedules = {} } = await chrome.storage.local.get("blockSchedules");
    const { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone } =
      await chrome.storage.local.get("timezone");
    const currentSites = [];
    for (const domain of blockedSites) {
      const schedule = blockSchedules[domain];
      if (!schedule || !schedule.enabled) continue;
      if (schedule.alwaysOn) {
        currentSites.push(domain);
      } else {
        const shouldBlock = isTimeInRange(schedule.startTime, schedule.endTime, timezone);
        if (shouldBlock) currentSites.push(domain);
      }
    }
    await updateActiveBlockRules(currentSites);
    console.log("Updated time-based blocking rules");
  } catch (error) {
    console.error("Error updating time-based blocking:", error);
  }
}

function isTimeInRange(startTime, endTime, timezone) {
  try {
    if (!startTime || !endTime) return false;
    const now = new Date();
    const options = { timeZone: timezone, hour12: false };
    const timeString = now.toLocaleTimeString("en-US", options);
    const [hours, minutes] = timeString.split(":").map(Number);
    const currentMinutes = hours * 60 + minutes;
    const [startHour, startMinute] = startTime.split(":").map(Number);
    const [endHour, endMinute] = endTime.split(":").map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    // Handle ranges that span midnight.
    if (endMinutes < startMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } catch (error) {
    console.error("Error checking time range:", error);
    return false;
  }
}

// Check if a specific domain should be blocked now.
async function checkBlockTimeForDomain(domain) {
  try {
    const { blockSchedules = {} } = await chrome.storage.local.get("blockSchedules");
    const { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone } =
      await chrome.storage.local.get("timezone");
    const schedule = blockSchedules[domain];
    if (!schedule || !schedule.enabled) return false;
    if (schedule.alwaysOn) return true;
    return isTimeInRange(schedule.startTime, schedule.endTime, timezone);
  } catch (error) {
    console.error("Error checking block time for domain:", error);
    return false;
  }
}

// In the updateBlockSchedule function:
async function updateBlockSchedule(domain, schedule) {
  try {
    // Retrieve both blockedSites and blockSchedules
    const { blockedSites = [], blockSchedules = {} } = await chrome.storage.local.get(["blockedSites", "blockSchedules"]);
    // Add the domain to blockedSites if not already present
    if (!blockedSites.includes(domain)) {
      blockedSites.push(domain);
    }
    // Update the schedule for the domain
    blockSchedules[domain] = schedule;
    // Save both blockedSites and blockSchedules
    await chrome.storage.local.set({ blockedSites, blockSchedules });
    // Trigger blocking rule update
    await updateTimeBasedBlocking();
    console.log(`Updated block schedule for ${domain}:`, schedule);
  } catch (error) {
    console.error("Error updating block schedule:", error);
  }
}

// Get all block rules (with dynamic rule IDs and schedules)
async function getAllBlockRules() {
  try {
    const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
    const { blockSchedules = {} } = await chrome.storage.local.get("blockSchedules");
    const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
    const rules = blockedSites.map((domain) => {
      const rule = dynamicRules.find((r) => r.condition && r.condition.urlFilter === domain);
      return {
        domain,
        ruleId: rule ? rule.id : 0,
        schedule: blockSchedules[domain] || {
          enabled: true,
          alwaysOn: true,
          startTime: "00:00",
          endTime: "23:59",
        },
      };
    });
    return rules;
  } catch (error) {
    console.error("Error getting all block rules:", error);
    return [];
  }
}

// Unblock a specific domain.
async function unblockSite(domain, ruleId) {
  try {
    console.log(`Unblocking domain: ${domain}, ruleId: ${ruleId}`);
    const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
    const { blockSchedules = {} } = await chrome.storage.local.get("blockSchedules");
    const updatedSites = blockedSites.filter((site) => site !== domain);
    delete blockSchedules[domain];
    await chrome.storage.local.set({ blockedSites: updatedSites, blockSchedules });
    if (ruleId) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleId],
        addRules: [],
      });
    } else {
      await updateTimeBasedBlocking();
    }
    console.log(`Successfully unblocked ${domain}`);
  } catch (error) {
    console.error(`Error unblocking site ${domain}:`, error);
  }
}

// --------------------
// DAILY STATISTICS & HELPERS
// --------------------

// Reset daily stats and store usage history
async function resetDailyStats() {
  try {
    const { usageTime = {} } = await chrome.storage.local.get("usageTime");
    const { usageHistory = [] } = await chrome.storage.local.get("usageHistory");
    if (Object.keys(usageTime).length > 0) {
      usageHistory.push({
        date: new Date().toISOString().split("T")[0],
        data: usageTime,
      });
      if (usageHistory.length > 30) {
        usageHistory.shift();
      }
      await chrome.storage.local.set({ usageHistory, usageTime: {} });
      console.log("Daily stats reset completed");
    }
  } catch (error) {
    console.error("Error resetting daily stats:", error);
  }
}

// Helper: get timestamp for next midnight
function getNextMidnight() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return midnight.getTime();
}

// Remove all dynamic blocking rules (used when the extension is disabled)
async function removeAllBlockingRules() {
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map((rule) => rule.id);
    if (existingRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRuleIds,
        addRules: [],
      });
      console.log("Removed all blocking rules because extension is disabled");
    }
  } catch (error) {
    console.error("Error removing blocking rules:", error);
  }
}
