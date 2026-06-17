/**
 * Management endpoints for key registration (admin only)
 */

import utils from './utils.js';
import roles from './roles.js';

var ROLES = roles.ROLES;

function handleManagement(r) {
    // Extract admin key
    var adminKey = utils.extractApiKey(r);

    if (!adminKey) {
        r.return(401, JSON.stringify({
            error: { message: "Authentication required", code: 401 }
        }));
        return;
    }

    // Check admin role using subrequest
    var body = JSON.stringify({ action: 'get_role', key: adminKey });

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

        var role = result ? result.role : null;

        if (role !== 'admin') {
            r.return(403, JSON.stringify({
                error: { message: "Admin access required", code: 403 }
            }));
            return;
        }

        // Route to handler
        if (r.uri === '/auth/register') {
            handleRegister(r);
        } else if (r.uri === '/auth/list') {
            handleList(r);
        } else if (r.uri === '/auth/delete') {
            handleDelete(r);
        } else {
            r.return(404, JSON.stringify({
                error: { message: "Not found", code: 404 }
            }));
        }
    });
}

function handleRegister(r) {
    if (r.method !== 'POST') {
        r.return(405, JSON.stringify({
            error: { message: "Method not allowed", code: 405 }
        }));
        return;
    }

    var body;
    try {
        var bodyText = r.requestText || r.requestBody || '';
        body = JSON.parse(bodyText || '{}');
    } catch (e) {
        r.return(400, JSON.stringify({
            error: { message: "Invalid JSON: " + e, code: 400 }
        }));
        return;
    }

    var role = body.role;
    var name = body.name;

    if (!role) {
        r.return(400, JSON.stringify({
            error: { message: "role is required", code: 400 }
        }));
        return;
    }

    if (!ROLES[role]) {
        r.return(400, JSON.stringify({
            error: { message: 'Invalid role: ' + role, code: 400 }
        }));
        return;
    }

    // Generate key internally (no Moonraker call)
    var key = generateApiKey();

    // Register key in our auth database
    var dbBody = JSON.stringify({
        action: 'register_key',
        key: key,
        role: role,
        name: name,
        created_by: 'admin'
    });

    r.subrequest('/internal_db', { method: 'POST', body: dbBody }, function(dbReply) {
        if (dbReply.status === 200) {
            r.return(200, JSON.stringify({
                result: { key: key, role: role, name: name }
            }));
        } else {
            r.return(500, JSON.stringify({
                error: { message: "Database error", code: 500 }
            }));
        }
    });
}

function generateApiKey() {
    // Generate secure random API key (32 hex chars)
    var chars = '0123456789abcdef';
    var result = '';
    for (var i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function handleList(r) {
    if (r.method !== 'GET') {
        r.return(405, JSON.stringify({
            error: { message: "Method not allowed", code: 405 }
        }));
        return;
    }

    var body = JSON.stringify({ action: 'list_keys' });

    r.subrequest('/internal_db', { method: 'POST', body: body }, function(reply) {
        if (reply.status === 200) {
            try {
                var result = JSON.parse(reply.responseText);
                r.return(200, JSON.stringify({
                    result: result.keys || []
                }));
            } catch (e) {
                r.return(500, JSON.stringify({
                    error: { message: "Parse error", code: 500 }
                }));
            }
        } else {
            r.return(500, JSON.stringify({
                error: { message: "Database error", code: 500 }
            }));
        }
    });
}

function handleDelete(r) {
    if (r.method !== 'POST') {
        r.return(405, JSON.stringify({
            error: { message: "Method not allowed", code: 405 }
        }));
        return;
    }

    var body;
    try {
        var bodyText = r.requestText || r.requestBody || '';
        body = JSON.parse(bodyText || '{}');
    } catch (e) {
        r.return(400, JSON.stringify({
            error: { message: "Invalid JSON", code: 400 }
        }));
        return;
    }

    var key = body.key;

    if (!key) {
        r.return(400, JSON.stringify({
            error: { message: "key is required", code: 400 }
        }));
        return;
    }

    var dbBody = JSON.stringify({ action: 'delete_key', key: key });

    r.subrequest('/internal_db', { method: 'POST', body: dbBody }, function(reply) {
        if (reply.status === 200) {
            r.return(200, JSON.stringify({
                result: { deleted: key }
            }));
        } else {
            r.return(500, JSON.stringify({
                error: { message: "Database error", code: 500 }
            }));
        }
    });
}

export default { handleManagement };
