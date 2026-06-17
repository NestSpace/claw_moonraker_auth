/**
 * Database client for njs - communicates with Python SQLite helper via proxy
 */

function getRole(r, key) {
    var body = JSON.stringify({ action: 'get_role', key: key });

    var reply = r.subrequest('/internal_db', {
        method: 'POST',
        body: body
    });

    if (reply.status === 200) {
        try {
            var result = JSON.parse(reply.responseText);
            return result ? result.role : null;
        } catch (e) {
            ngx.log(ngx.ERR, 'DB parse error: ' + e);
            return null;
        }
    }

    return null;
}

function registerKey(r, key, role, name, createdBy) {
    var body = JSON.stringify({
        action: 'register_key',
        key: key,
        role: role,
        name: name,
        created_by: createdBy
    });

    var reply = r.subrequest('/internal_db', {
        method: 'POST',
        body: body
    });

    return reply.status === 200 ? { success: true } : { error: 'DB error' };
}

function touchKey(r, key) {
    // Non-blocking update - fire and forget
    try {
        var body = JSON.stringify({ action: 'touch_key', key: key });
        r.subrequest('/internal_db', { method: 'POST', body: body });
    } catch (e) {
        // Ignore errors
    }
}

function listKeys(r) {
    var body = JSON.stringify({ action: 'list_keys' });

    var reply = r.subrequest('/internal_db', {
        method: 'POST',
        body: body
    });

    if (reply.status === 200) {
        try {
            var result = JSON.parse(reply.responseText);
            return result ? result.keys : [];
        } catch (e) {
            return [];
        }
    }

    return [];
}

function deleteKey(r, key) {
    var body = JSON.stringify({ action: 'delete_key', key: key });

    var reply = r.subrequest('/internal_db', {
        method: 'POST',
        body: body
    });

    return reply.status === 200 ? { success: true } : { error: 'DB error' };
}

export default { getRole, registerKey, touchKey, listKeys, deleteKey };
