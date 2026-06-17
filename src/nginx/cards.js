/**
 * Card-based access control for Moonraker
 * Supports admin/manager cards (return API keys) and token cards (execute requests)
 */

import utils from './utils.js';
import roles from './roles.js';

var ROLES = roles.ROLES;

/**
 * Normalize card ID to lowercase for case-insensitive handling
 */
function normalizeCardId(cardId) {
    return cardId ? cardId.toLowerCase().trim() : cardId;
}

/**
 * Helper to set API key for subrequests
 */
function setCreatorKey(r) {
    return r.args.creator_key || '';
}

/**
 * Generate API key (32 hex chars)
 */
function generateApiKey() {
    var chars = '0123456789abcdef';
    var result = '';
    for (var i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * POST /access/card/register
 * Create a new card (admin/manager/token)
 */
function registerCard(r) {
    if (r.method !== 'POST') {
        r.return(405, JSON.stringify({
            error: { message: "Method not allowed", code: 405 }
        }));
        return;
    }

    // Extract creator's API key
    var creatorKey = utils.extractApiKey(r);

    if (!creatorKey) {
        r.return(401, JSON.stringify({
            error: { message: "Authentication required", code: 401 }
        }));
        return;
    }

    // Check creator's role
    var body = JSON.stringify({ action: 'get_role', key: creatorKey });

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

        var creatorRole = result ? result.role : null;

        if (!creatorRole) {
            r.return(403, JSON.stringify({
                error: { message: "Invalid creator key", code: 403 }
            }));
            return;
        }

        // Set the stripped key header so internal subrequests can use it
        r.headersOut['X-Stripped-Api-Key'] = creatorKey;

        // Parse request body
        var requestBody;
        try {
            var bodyText = r.requestText || r.requestBody || '';
            requestBody = JSON.parse(bodyText || '{}');
        } catch (e) {
            r.return(400, JSON.stringify({
                error: { message: "Invalid JSON: " + e, code: 400 }
            }));
            return;
        }

        var cardId = requestBody.card_id;
        var cardRole = requestBody.role;
        var cardName = requestBody.name;

        if (!cardId) {
            r.return(400, JSON.stringify({
                error: { message: "card_id is required", code: 400 }
            }));
            return;
        }

        // Normalize card ID to lowercase for case-insensitive handling
        cardId = normalizeCardId(cardId);

        if (!cardRole) {
            r.return(400, JSON.stringify({
                error: { message: "role is required", code: 400 }
            }));
            return;
        }

        // Check permissions: admin can create all, manager can only create token
        if (creatorRole === 'manager' && cardRole !== 'token') {
            r.return(403, JSON.stringify({
                error: { message: "Managers can only create token cards", code: 403 }
            }));
            return;
        }

        if (creatorRole !== 'admin' && creatorRole !== 'manager') {
            r.return(403, JSON.stringify({
                error: { message: "Only admin and manager can create cards", code: 403 }
            }));
            return;
        }

        // Validate card role
        if (cardRole !== 'admin' && cardRole !== 'manager' && cardRole !== 'token') {
            r.return(400, JSON.stringify({
                error: { message: "Invalid card role: " + cardRole, code: 400 }
            }));
            return;
        }

        // Handle admin/manager cards: generate API key in Moonraker
        if (cardRole === 'admin' || cardRole === 'manager') {
            handleAuthCard(r, cardId, cardRole, cardName, creatorKey);
        } else {
            // Handle token cards: store request details
            handleTokenCard(r, cardId, requestBody, creatorKey);
        }
    });
}

function handleAuthCard(r, cardId, cardRole, cardName, creatorKey) {
    // Generate API key internally (no Moonraker call)
    var apiKey = generateApiKey();

    // Step 1: Register API key in auth database
    var authDbBody = JSON.stringify({
        action: 'register_key',
        key: apiKey,
        role: cardRole,
        name: cardName,
        created_by: creatorKey
    });

    r.subrequest('/internal_db', { method: 'POST', body: authDbBody }, function(authReply) {
        if (authReply.status !== 200) {
            r.return(500, JSON.stringify({
                error: { message: "Failed to register API key", code: 500 }
            }));
            return;
        }

        // Step 2: Register card in cards table
        var cardDbBody = JSON.stringify({
            action: 'register_card',
            card_id: cardId,
            is_token: 0,
            name: cardName,
            api_key: apiKey,
            owner: creatorKey,
            once: 0
        });

        r.subrequest('/internal_db', { method: 'POST', body: cardDbBody }, function(cardReply) {
            if (cardReply.status === 200) {
                r.return(200, JSON.stringify({
                    result: {
                        card_id: cardId,
                        role: cardRole,
                        name: cardName,
                        created_by: creatorKey,
                        created_at: Date.now()
                    }
                }));
            } else {
                r.return(500, JSON.stringify({
                    error: { message: "Failed to register card", code: 500 }
                }));
            }
        });
    });
}

function handleTokenCard(r, cardId, requestBody, creatorKey) {
    var requestPath = requestBody.request_path;
    var requestBodyData = requestBody.request_body;
    var once = requestBody.once || false;
    var cardName = requestBody.name;

    if (!requestPath) {
        r.return(400, JSON.stringify({
            error: { message: "request_path is required for token cards", code: 400 }
        }));
        return;
    }

    // Store request body as JSON string
    var requestBodyJson = JSON.stringify(requestBodyData || {});

    var cardDbBody = JSON.stringify({
        action: 'register_card',
        card_id: cardId,
        is_token: 1,
        name: cardName,
        request_path: requestPath,
        request_body: requestBodyJson,
        owner: creatorKey,
        once: once ? 1 : 0
    });

    r.subrequest('/internal_db', { method: 'POST', body: cardDbBody }, function(reply) {
        if (reply.status === 200) {
            r.return(200, JSON.stringify({
                result: {
                    card_id: cardId,
                    role: 'token',
                    name: cardName,
                    created_by: creatorKey,
                    created_at: Date.now()
                }
            }));
        } else {
            r.return(500, JSON.stringify({
                error: { message: "Failed to register card", code: 500 }
            }));
        }
    });
}

/**
 * GET /access/card?card_id=xxx&type=auth|trigger|all
 * Access a card (no auth required - card_id is the secret)
 */
function getCard(r) {
    if (r.method !== 'GET') {
        r.return(405, JSON.stringify({
            error: { message: "Method not allowed", code: 405 }
        }));
        return;
    }

    var cardId = r.args.card_id;
    var typeFilter = r.args.type || 'all';

    if (!cardId) {
        r.return(400, JSON.stringify({
            error: { message: "card_id is required", code: 400 }
        }));
        return;
    }

    // Normalize card ID to lowercase for case-insensitive handling
    cardId = normalizeCardId(cardId);

    // Look up card in database
    var body = JSON.stringify({ action: 'get_card', card_id: cardId });

    r.subrequest('/internal_db', { method: 'POST', body: body }, function(reply) {
        if (reply.status !== 200) {
            r.return(500, JSON.stringify({
                error: { message: "Database error", code: 500 }
            }));
            return;
        }

        var card;
        try {
            card = JSON.parse(reply.responseText);
        } catch (e) {
            r.return(500, JSON.stringify({
                error: { message: "Database parse error", code: 500 }
            }));
            return;
        }

        if (!card) {
            r.return(404, JSON.stringify({
                error: { message: "Card not found", code: 404 }
            }));
            return;
        }

        // Check type filter
        if (typeFilter === 'auth' && card.is_token === 1) {
            r.return(403, JSON.stringify({
                error: { message: "Token cards cannot be accessed with type=auth", code: 403 }
            }));
            return;
        }

        if (typeFilter === 'trigger' && card.is_token === 0) {
            r.return(403, JSON.stringify({
                error: { message: "Auth cards cannot be accessed with type=trigger", code: 403 }
            }));
            return;
        }

        // Handle based on card type
        if (card.is_token === 0) {
            handleAuthCardAccess(r, card);
        } else if (card.is_token === 1) {
            handleTokenCardAccess(r, card);
        } else {
            r.return(500, JSON.stringify({
                error: { message: "Invalid card type", code: 500 }
            }));
        }
    });
}

function handleAuthCardAccess(r, card) {
    // Update last_used
    var touchBody = JSON.stringify({ action: 'touch_card', card_id: card.card_id });
    r.subrequest('/internal_db', { method: 'POST', body: touchBody }, function() {});

    // Fetch role from api_keys table
    var roleBody = JSON.stringify({ action: 'get_role', key: card.api_key });
    r.subrequest('/internal_db', { method: 'POST', body: roleBody }, function(roleReply) {
        if (roleReply.status !== 200) {
            r.return(500, JSON.stringify({
                error: { message: "Failed to fetch role", code: 500 }
            }));
            return;
        }

        var roleResult;
        try {
            roleResult = JSON.parse(roleReply.responseText);
        } catch (e) {
            r.return(500, JSON.stringify({
                error: { message: "Parse error", code: 500 }
            }));
            return;
        }

        var role = roleResult ? roleResult.role : 'unknown';

        // Return API key with role
        r.return(200, JSON.stringify({
            result: {
                type: role,
                api_key: card.api_key
            }
        }));
    });
}

function handleTokenCardAccess(r, card) {
    // Execute request on Moonraker using owner's API key
    var requestPath = card.request_path;
    var requestBodyData = card.request_body;
    var ownerKey = card.owner;

    // Build the full subrequest path with owner key
    var subrequestPath = '/internal_token_execute' + requestPath + '?owner_key=' + encodeURIComponent(ownerKey);

    // Determine method
    var method = 'GET';
    if (requestPath.indexOf('gcode/script') >= 0 || requestPath.indexOf('api_key') >= 0) {
        method = 'POST';
    }

    var subrequestOptions = { method: method };

    if (method === 'POST' && requestBodyData) {
        subrequestOptions.body = requestBodyData;
    }

    r.subrequest(subrequestPath, subrequestOptions, function(moonrakerReply) {
        var response;
        try {
            response = JSON.parse(moonrakerReply.responseText || '{}');
        } catch (e) {
            response = { error: 'Failed to parse response', raw: moonrakerReply.responseText };
        }

        // Update last_used
        var touchBody = JSON.stringify({ action: 'touch_card', card_id: card.card_id });
        r.subrequest('/internal_db', { method: 'POST', body: touchBody }, function() {});

        // If once=true, delete the card
        if (card.once === 1) {
            var deleteBody = JSON.stringify({ action: 'delete_card', card_id: card.card_id });
            r.subrequest('/internal_db', { method: 'POST', body: deleteBody }, function() {});
        }

        // Return Moonraker response
        r.return(moonrakerReply.status, JSON.stringify({
            result: {
                type: 'token',
                response: response
            }
        }));
    });
}

/**
 * GET /access/card/list
 * List all cards (admin only)
 */
function listCards(r) {
    if (r.method !== 'GET') {
        r.return(405, JSON.stringify({
            error: { message: "Method not allowed", code: 405 }
        }));
        return;
    }

    // Extract admin key
    var adminKey = utils.extractApiKey(r);

    if (!adminKey) {
        r.return(401, JSON.stringify({
            error: { message: "Authentication required", code: 401 }
        }));
        return;
    }

    // Check admin role
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

        // List cards
        var listBody = JSON.stringify({ action: 'list_cards' });

        r.subrequest('/internal_db', { method: 'POST', body: listBody }, function(listReply) {
            if (listReply.status === 200) {
                try {
                    var listResult = JSON.parse(listReply.responseText);
                    var cards = listResult.cards || [];

                    // Database already returns role via JOIN and api_key preview
                    r.return(200, JSON.stringify({
                        result: cards
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
    });
}

/**
 * POST /access/card/delete
 * Delete a card (admin or owner)
 */
function deleteCard(r) {
    if (r.method !== 'POST') {
        r.return(405, JSON.stringify({
            error: { message: "Method not allowed", code: 405 }
        }));
        return;
    }

    // Extract requester's API key
    var requesterKey = utils.extractApiKey(r);

    if (!requesterKey) {
        r.return(401, JSON.stringify({
            error: { message: "Authentication required", code: 401 }
        }));
        return;
    }

    // Parse request body
    var requestBody;
    try {
        var bodyText = r.requestText || r.requestBody || '';
        requestBody = JSON.parse(bodyText || '{}');
    } catch (e) {
        r.return(400, JSON.stringify({
            error: { message: "Invalid JSON", code: 400 }
        }));
        return;
    }

    var cardId = requestBody.card_id;

    if (!cardId) {
        r.return(400, JSON.stringify({
            error: { message: "card_id is required", code: 400 }
        }));
        return;
    }

    // Normalize card ID to lowercase for case-insensitive handling
    cardId = normalizeCardId(cardId);

    // Check requester's role
    var roleBody = JSON.stringify({ action: 'get_role', key: requesterKey });

    r.subrequest('/internal_db', { method: 'POST', body: roleBody }, function(reply) {
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

        var requesterRole = result ? result.role : null;

        if (!requesterRole) {
            r.return(403, JSON.stringify({
                error: { message: "Invalid requester key", code: 403 }
            }));
            return;
        }

        // Admin can delete any card
        if (requesterRole === 'admin') {
            performDelete(r, cardId);
            return;
        }

        // Manager can delete their own token cards
        if (requesterRole === 'manager') {
            // Check if requester owns the card
            var ownerBody = JSON.stringify({ action: 'check_card_owner', card_id: cardId });

            r.subrequest('/internal_db', { method: 'POST', body: ownerBody }, function(ownerReply) {
                if (ownerReply.status !== 200) {
                    r.return(500, JSON.stringify({
                        error: { message: "Database error", code: 500 }
                    }));
                    return;
                }

                var ownerResult;
                try {
                    ownerResult = JSON.parse(ownerReply.responseText);
                } catch (e) {
                    r.return(500, JSON.stringify({
                        error: { message: "Database parse error", code: 500 }
                    }));
                    return;
                }

                if (!ownerResult || ownerResult.owner !== requesterKey) {
                    r.return(403, JSON.stringify({
                        error: { message: "You can only delete your own cards", code: 403 }
                    }));
                    return;
                }

                performDelete(r, cardId);
            });
            return;
        }

        // Others cannot delete cards
        r.return(403, JSON.stringify({
            error: { message: "Insufficient permissions", code: 403 }
        }));
    });
}

function performDelete(r, cardId) {
    var deleteBody = JSON.stringify({ action: 'delete_card', card_id: cardId });

    r.subrequest('/internal_db', { method: 'POST', body: deleteBody }, function(reply) {
        if (reply.status === 200) {
            r.return(200, JSON.stringify({
                result: { deleted: cardId }
            }));
        } else {
            r.return(500, JSON.stringify({
                error: { message: "Database error", code: 500 }
            }));
        }
    });
}

export default { registerCard, getCard, listCards, deleteCard, setCreatorKey };
