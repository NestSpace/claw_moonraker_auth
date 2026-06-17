/**
 * Secure authentication with database-backed role lookup
 */

import roles from './roles.js';
import utils from './utils.js';

var ROLES = roles.ROLES;

function authenticateRequest(r) {
    var apiKey = utils.extractApiKey(r);

    if (!apiKey) {
        r.return(401, JSON.stringify({
            error: { message: "API key required", code: 401 }
        }));
        return;
    }

    // Look up role in database using subrequest
    var body = JSON.stringify({ action: 'get_role', key: apiKey });

    r.subrequest('/internal_db', { method: 'POST', body: body }, function(reply) {
        if (reply.status !== 200) {
            r.return(500, JSON.stringify({
                error: { message: "Database error", code: 500 }
            }));
            return;
        }

        var result;
        try {
            result = JSON.parse(reply.responseText);
        } catch (e) {
            r.return(500, JSON.stringify({
                error: { message: "Database parse error", code: 500 }
            }));
            return;
        }

        var roleKey = result ? result.role : null;

        if (!roleKey) {
            r.return(403, JSON.stringify({
                error: { message: "Invalid or unregistered API key", code: 403 }
            }));
            return;
        }

        var role = ROLES[roleKey];
        if (!role) {
            r.return(500, JSON.stringify({
                error: { message: "Invalid role configuration", code: 500 }
            }));
            return;
        }

        r.log('Auth: role=' + role.name + ', uri=' + r.uri + ', method=' + r.method);

        // Update last used timestamp (fire and forget)
        var touchBody = JSON.stringify({ action: 'touch_key', key: apiKey });
        r.subrequest('/internal_db', { method: 'POST', body: touchBody }, function() {});

        // Check method allowed
        if (!role.allowed_methods.includes(r.method)) {
            r.return(403, JSON.stringify({
                error: { message: 'Method ' + r.method + ' not allowed for ' + role.name, code: 403 }
            }));
            return;
        }

        // Check blocked patterns
        if (utils.matchesPattern(r.uri, role.blocked_patterns)) {
            r.return(403, JSON.stringify({
                error: { message: 'Access denied to ' + r.uri + ' for ' + role.name, code: 403 }
            }));
            return;
        }

        // Check blocked methods for specific endpoints
        if (role.blocked_methods) {
            for (var endpoint in role.blocked_methods) {
                if (r.uri === endpoint || r.uri.startsWith(endpoint + '/')) {
                    if (role.blocked_methods[endpoint].includes(r.method)) {
                        r.return(403, JSON.stringify({
                            error: { message: 'Method ' + r.method + ' not allowed on ' + endpoint + ' for ' + role.name, code: 403 }
                        }));
                        return;
                    }
                }
            }
        }

        // Pass key as-is to Moonraker (no prefix stripping)
        r.headersOut['X-Stripped-Api-Key'] = apiKey;

        // Forward to Moonraker
        r.internalRedirect('@moonraker');
    });
}

export default { authenticateRequest };
