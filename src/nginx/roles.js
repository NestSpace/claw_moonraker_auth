const ROLES = {
    admin: {
        name: "Administrator",
        blocked_patterns: [],
        allowed_methods: ["GET", "POST", "DELETE", "PUT", "PATCH"]
    },
    manager: {
        name: "Manager",
        blocked_patterns: [
            /^\/access\/api_key/,
            /^\/api\/access\/api_key/,
            /^\/api\/access\/get_api_key/,
            /^\/api\/access\/post_api_key/,
            /^\/auth\//
        ],
        blocked_methods: {
            "/access/user": ["POST", "DELETE"]
        },
        allowed_methods: ["GET", "POST", "DELETE", "PUT", "PATCH"]
    },
    legacy: {
        name: "Legacy API Key",
        blocked_patterns: [],
        allowed_methods: ["GET", "POST", "DELETE", "PUT", "PATCH"]
    }
};

export default { ROLES };
