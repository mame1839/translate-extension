function canonicalSiteHost(url) {
    const host = String(url.host || '').toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
}

function canonicalSitePath(url) {
    const pathname = url.pathname || '/';
    return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function parseSiteUrl(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
    let url;
    try { url = new URL(withScheme); } catch (e) { return null; }
    if (!url.host) return null;
    return url;
}

const SITE_HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const SITE_SCHEME_PREFIX_PATTERN = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const SITE_HTTP_URL_PATTERN = /^https?:\/\//i;

function isUsableSiteEntry(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith('/')) return false;
    if (SITE_SCHEME_PREFIX_PATTERN.test(trimmed) && !SITE_HTTP_URL_PATTERN.test(trimmed)) return false;
    const url = parseSiteUrl(trimmed);
    if (!url) return false;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.hostname.startsWith('[')) return true;
    return SITE_HOSTNAME_PATTERN.test(url.hostname);
}

function siteEntryMatchesUrl(entry, currentUrl) {
    const entryUrl = parseSiteUrl(entry);
    if (!entryUrl) return false;
    const pageUrl = parseSiteUrl(currentUrl);
    if (!pageUrl) return false;
    if (canonicalSiteHost(entryUrl) !== canonicalSiteHost(pageUrl)) return false;
    const entryPath = canonicalSitePath(entryUrl);
    if (entryPath === '/') return true;
    const pagePath = canonicalSitePath(pageUrl);
    return pagePath === entryPath || pagePath.startsWith(entryPath + '/');
}

function siteListMatchesUrl(list, currentUrl) {
    if (!Array.isArray(list)) return false;
    return list.some(entry => siteEntryMatchesUrl(entry, currentUrl));
}
