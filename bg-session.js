let sessionMutex = Promise.resolve();

function withSessionLock(fn) {
    const run = sessionMutex.then(() => fn().catch(() => { }));
    sessionMutex = run.catch(() => { });
    return run;
}

function markSessionTranslated(tabId, hostname) {
    return withSessionLock(async () => {
        const { sessionTabDomains = {}, sessionTranslatedDomains = [] } = await chrome.storage.session.get(['sessionTabDomains', 'sessionTranslatedDomains']);
        const oldHostname = sessionTabDomains[tabId];
        let mutated = false;
        if (oldHostname !== hostname) {
            sessionTabDomains[tabId] = hostname;
            mutated = true;
            if (oldHostname) {
                const stillUsed = Object.values(sessionTabDomains).includes(oldHostname);
                if (!stillUsed) {
                    const idx = sessionTranslatedDomains.indexOf(oldHostname);
                    if (idx >= 0) sessionTranslatedDomains.splice(idx, 1);
                }
            }
        }
        if (!sessionTranslatedDomains.includes(hostname)) {
            sessionTranslatedDomains.push(hostname);
            mutated = true;
        }
        if (mutated) {
            await chrome.storage.session.set({ sessionTabDomains, sessionTranslatedDomains });
        }
    });
}

async function isSessionDomainKnown(hostname) {
    const { sessionTranslatedDomains = [] } = await chrome.storage.session.get(['sessionTranslatedDomains']);
    return Array.isArray(sessionTranslatedDomains) && sessionTranslatedDomains.includes(hostname);
}

function untrackSessionTab(tabId) {
    return withSessionLock(async () => {
        const { sessionTabDomains = {}, sessionTranslatedDomains = [] } = await chrome.storage.session.get(['sessionTabDomains', 'sessionTranslatedDomains']);
        if (!(tabId in sessionTabDomains)) return;
        const hostname = sessionTabDomains[tabId];
        delete sessionTabDomains[tabId];
        let removedHostname = false;
        if (hostname) {
            const stillUsed = Object.values(sessionTabDomains).includes(hostname);
            if (!stillUsed) {
                const idx = sessionTranslatedDomains.indexOf(hostname);
                if (idx >= 0) {
                    sessionTranslatedDomains.splice(idx, 1);
                    removedHostname = true;
                }
            }
        }
        await chrome.storage.session.set({
            sessionTabDomains,
            ...(removedHostname ? { sessionTranslatedDomains } : {})
        });
    });
}

function handleTabUrlChange(tabId, newUrl) {
    return withSessionLock(async () => {
        const newHostname = getHostnameFromUrl(newUrl);
        const { sessionTabDomains = {}, sessionTranslatedDomains = [] } = await chrome.storage.session.get(['sessionTabDomains', 'sessionTranslatedDomains']);
        const oldHostname = sessionTabDomains[tabId];
        if (oldHostname === newHostname) return;
        if (!oldHostname) return;
        if (newHostname) {
            sessionTabDomains[tabId] = newHostname;
        } else {
            delete sessionTabDomains[tabId];
        }
        const stillUsed = Object.values(sessionTabDomains).includes(oldHostname);
        let updates = { sessionTabDomains };
        if (!stillUsed) {
            const idx = sessionTranslatedDomains.indexOf(oldHostname);
            if (idx >= 0) {
                sessionTranslatedDomains.splice(idx, 1);
                updates.sessionTranslatedDomains = sessionTranslatedDomains;
            }
        }
        await chrome.storage.session.set(updates);
    });
}
