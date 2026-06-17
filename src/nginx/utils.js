function extractApiKey(r) {
    // Check X-Api-Key header (case-insensitive)
    let apiKey = r.headersIn['X-Api-Key'] || r.headersIn['x-api-key'];
    if (apiKey) return apiKey;

    // Check Authorization header (Bearer token)
    let auth = r.headersIn['Authorization'];
    if (auth && auth.startsWith('Bearer ')) {
        return auth.substring(7);
    }

    // Check query string
    if (r.args.api_key) {
        return r.args.api_key;
    }

    return null;
}

function extractPrefix(apiKey) {
    if (!apiKey) return null;

    if (apiKey.startsWith('admin_')) {
        return 'admin';
    } else if (apiKey.startsWith('manager_')) {
        return 'manager';
    }

    return 'legacy';
}

function matchesPattern(uri, patterns) {
    for (var i = 0; i < patterns.length; i++) {
        var pattern = patterns[i];
        if (pattern.test(uri)) {
            return true;
        }
    }
    return false;
}

export default { extractApiKey, extractPrefix, matchesPattern };
