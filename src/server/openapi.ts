/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */

/**
 * OpenAPI 3.0 specification for the Cynapx REST API.
 * Endpoints mirror the Zod schemas defined in api-server.ts.
 */
export const openApiSpec = {
    openapi: '3.0.3',
    info: {
        title: 'Cynapx Code Knowledge API',
        version: '1.0.0',
        description:
            'REST API for the Cynapx high-performance code knowledge engine. ' +
            'All endpoints (except the MCP passthrough GET) require a Bearer token ' +
            'via the Authorization header.',
    },
    servers: [{ url: '/', description: 'Local Cynapx server' }],
    security: [{ bearerAuth: [] }],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'hex',
                description: 'Set via KNOWLEDGE_TOOL_TOKEN environment variable (or auto-generated on startup).',
            },
        },
        schemas: {
            SymbolRef: {
                type: 'object',
                required: ['qualified_name'],
                properties: {
                    qualified_name: { type: 'string', minLength: 1, example: 'MyModule.MyClass.myMethod' },
                },
            },
            GraphNode: {
                type: 'object',
                properties: {
                    id: { type: 'string', example: '42' },
                    symbol: {
                        type: 'object',
                        properties: {
                            qualified_name: { type: 'string' },
                            symbol_type: { type: 'string' },
                        },
                    },
                    location: {
                        type: 'object',
                        properties: {
                            file_path: { type: 'string' },
                            start_line: { type: 'integer' },
                            end_line: { type: 'integer' },
                        },
                    },
                    metrics: {
                        type: 'object',
                        properties: {
                            loc: { type: 'integer' },
                            cyclomatic: { type: 'integer' },
                            fan_in: { type: 'integer' },
                            fan_out: { type: 'integer' },
                        },
                    },
                    last_updated_commit: { type: 'string' },
                },
            },
            GraphEdge: {
                type: 'object',
                properties: {
                    from: { type: 'string' },
                    to: { type: 'string' },
                    type: { type: 'string' },
                    line: { type: 'integer', nullable: true },
                },
            },
            ErrorResponse: {
                type: 'object',
                properties: {
                    error_code: { type: 'string', example: 'SYMBOL_NOT_FOUND' },
                    message: { type: 'string', example: 'No node found for the given qualified name.' },
                },
            },
            ValidationError: {
                type: 'object',
                properties: {
                    error: { type: 'string', example: 'Validation failed' },
                    details: {
                        type: 'array',
                        items: { type: 'object' },
                    },
                },
            },
            UnauthorizedError: {
                type: 'object',
                properties: {
                    error_code: { type: 'string', example: 'UNAUTHORIZED' },
                    message: { type: 'string', example: 'Invalid or missing Bearer Token' },
                },
            },
        },
    },
    paths: {
        '/api/docs': {
            get: {
                summary: 'Swagger UI (this page)',
                description: 'Serves the interactive OpenAPI documentation. No authentication required.',
                security: [],
                tags: ['Meta'],
                responses: {
                    200: { description: 'HTML documentation page' },
                },
            },
        },
        '/mcp': {
            get: {
                summary: 'MCP protocol passthrough (GET — no auth required)',
                description:
                    'Handles GET requests for the Model Context Protocol (MCP) Streamable HTTP transport. ' +
                    'This path is exempt from Bearer token authentication.',
                security: [],
                tags: ['MCP'],
                responses: {
                    200: { description: 'MCP session response' },
                    503: {
                        description: 'MCP server not initialized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                },
            },
            post: {
                summary: 'MCP protocol passthrough (POST)',
                description: 'Handles POST requests for the MCP Streamable HTTP transport.',
                tags: ['MCP'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { type: 'object', description: 'MCP JSON-RPC request body' },
                        },
                    },
                },
                responses: {
                    200: { description: 'MCP JSON-RPC response' },
                    401: {
                        description: 'Unauthorized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UnauthorizedError' },
                            },
                        },
                    },
                    503: {
                        description: 'MCP server not initialized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                },
            },
            delete: {
                summary: 'MCP protocol passthrough (DELETE)',
                description: 'Handles DELETE requests for the MCP Streamable HTTP transport (session teardown).',
                tags: ['MCP'],
                responses: {
                    200: { description: 'MCP session deleted' },
                    401: {
                        description: 'Unauthorized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UnauthorizedError' },
                            },
                        },
                    },
                },
            },
        },
        '/api/symbol/get': {
            post: {
                summary: 'Get symbol details',
                description:
                    'Retrieves full details for a symbol identified by its qualified name, including ' +
                    'incoming and outgoing edges.',
                tags: ['Symbols'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['qualified_name'],
                                properties: {
                                    qualified_name: {
                                        type: 'string',
                                        minLength: 1,
                                        description: 'Fully-qualified symbol name.',
                                        example: 'MyModule.MyClass.myMethod',
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Symbol node with edges',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        node: { $ref: '#/components/schemas/GraphNode' },
                                        outgoing_edges: {
                                            type: 'array',
                                            items: { $ref: '#/components/schemas/GraphEdge' },
                                        },
                                        incoming_edges: {
                                            type: 'array',
                                            items: { $ref: '#/components/schemas/GraphEdge' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: {
                        description: 'Validation error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ValidationError' },
                            },
                        },
                    },
                    401: {
                        description: 'Unauthorized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UnauthorizedError' },
                            },
                        },
                    },
                    404: {
                        description: 'Symbol not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                    500: {
                        description: 'Internal error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                },
            },
        },
        '/api/graph/callers': {
            post: {
                summary: 'Get callers of a symbol',
                description:
                    'Performs a BFS traversal in the incoming direction from the given symbol, ' +
                    'returning all nodes that (transitively) call it.',
                tags: ['Graph'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['symbol'],
                                properties: {
                                    symbol: { $ref: '#/components/schemas/SymbolRef' },
                                    max_depth: {
                                        type: 'integer',
                                        minimum: 1,
                                        description: 'Maximum traversal depth (default: 1).',
                                        example: 2,
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Root node and list of callers',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        root: { $ref: '#/components/schemas/GraphNode' },
                                        callers: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    node: { $ref: '#/components/schemas/GraphNode' },
                                                    distance: { type: 'integer' },
                                                    path: { type: 'array', items: { type: 'string' } },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: {
                        description: 'Validation error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ValidationError' },
                            },
                        },
                    },
                    401: {
                        description: 'Unauthorized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UnauthorizedError' },
                            },
                        },
                    },
                    404: {
                        description: 'Symbol not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                    500: {
                        description: 'Internal error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                },
            },
        },
        '/api/graph/callees': {
            post: {
                summary: 'Get callees of a symbol',
                description:
                    'Performs a BFS traversal in the outgoing direction from the given symbol, ' +
                    'returning all nodes it (transitively) calls.',
                tags: ['Graph'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['symbol'],
                                properties: {
                                    symbol: { $ref: '#/components/schemas/SymbolRef' },
                                    max_depth: {
                                        type: 'integer',
                                        minimum: 1,
                                        description: 'Maximum traversal depth (default: 1).',
                                        example: 2,
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Root node and list of callees',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        root: { $ref: '#/components/schemas/GraphNode' },
                                        callees: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    node: { $ref: '#/components/schemas/GraphNode' },
                                                    distance: { type: 'integer' },
                                                    path: { type: 'array', items: { type: 'string' } },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: {
                        description: 'Validation error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ValidationError' },
                            },
                        },
                    },
                    401: {
                        description: 'Unauthorized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UnauthorizedError' },
                            },
                        },
                    },
                    404: {
                        description: 'Symbol not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                    500: {
                        description: 'Internal error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                },
            },
        },
        '/api/analysis/impact': {
            post: {
                summary: 'Impact analysis',
                description:
                    'Identifies all nodes affected by a change to the given symbol via an incoming ' +
                    'BFS traversal (default max_depth: 3). Subject to a stricter rate limit (10 req/min).',
                tags: ['Analysis'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['symbol'],
                                properties: {
                                    symbol: { $ref: '#/components/schemas/SymbolRef' },
                                    max_depth: {
                                        type: 'integer',
                                        minimum: 1,
                                        description: 'Maximum traversal depth (default: 3).',
                                        example: 3,
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Affected nodes with distance and impact path',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        affected_nodes: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    node: { $ref: '#/components/schemas/GraphNode' },
                                                    distance: { type: 'integer' },
                                                    impact_path: { type: 'array', items: { type: 'string' } },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: {
                        description: 'Validation error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ValidationError' },
                            },
                        },
                    },
                    401: {
                        description: 'Unauthorized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UnauthorizedError' },
                            },
                        },
                    },
                    404: {
                        description: 'Symbol not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                    429: {
                        description: 'Rate limit exceeded (10 req/min for analysis endpoints)',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                    500: {
                        description: 'Internal error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                },
            },
        },
        '/api/analysis/hotspots': {
            post: {
                summary: 'Code hotspot detection',
                description:
                    'Returns symbols ranked by the chosen complexity metric. Subject to a stricter ' +
                    'rate limit (10 req/min). Returns up to 100 results.',
                tags: ['Analysis'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['metric'],
                                properties: {
                                    metric: {
                                        type: 'string',
                                        enum: ['loc', 'cyclomatic', 'fan_in', 'fan_out', 'fan_in_dynamic', 'fan_out_dynamic'],
                                        description: 'The metric to rank symbols by.',
                                        example: 'cyclomatic',
                                    },
                                    threshold: {
                                        type: 'number',
                                        description: 'Minimum metric value to include (default: 0).',
                                        example: 5,
                                    },
                                    symbol_type: {
                                        type: 'string',
                                        description: 'Filter results to a specific symbol type (e.g. "function").',
                                        example: 'function',
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Ranked list of hotspot nodes',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        hotspots: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    node: { $ref: '#/components/schemas/GraphNode' },
                                                    metric_value: { type: 'number' },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: {
                        description: 'Validation error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ValidationError' },
                            },
                        },
                    },
                    401: {
                        description: 'Unauthorized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UnauthorizedError' },
                            },
                        },
                    },
                    429: {
                        description: 'Rate limit exceeded (10 req/min for analysis endpoints)',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                    500: {
                        description: 'Internal error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                },
            },
        },
        '/api/analysis/tests': {
            post: {
                summary: 'Find tests for a symbol',
                description:
                    'Finds test nodes that cover the given production symbol by inspecting incoming ' +
                    'call edges whose source file path contains "test" or "spec". Subject to a stricter ' +
                    'rate limit (10 req/min).',
                tags: ['Analysis'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['symbol'],
                                properties: {
                                    symbol: { $ref: '#/components/schemas/SymbolRef' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Production node and related test nodes',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        production_node: { $ref: '#/components/schemas/GraphNode' },
                                        tests: {
                                            type: 'array',
                                            items: { $ref: '#/components/schemas/GraphNode' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: {
                        description: 'Validation error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ValidationError' },
                            },
                        },
                    },
                    401: {
                        description: 'Unauthorized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UnauthorizedError' },
                            },
                        },
                    },
                    404: {
                        description: 'Symbol not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                    429: {
                        description: 'Rate limit exceeded (10 req/min for analysis endpoints)',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                    500: {
                        description: 'Internal error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                },
            },
        },
        '/api/search/symbols': {
            post: {
                summary: 'Search symbols',
                description: 'Full-text search over symbol qualified names. Returns up to `limit` matches (default 20).',
                tags: ['Symbols'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['query'],
                                properties: {
                                    query: {
                                        type: 'string',
                                        minLength: 1,
                                        description: 'Search string.',
                                        example: 'handleGetCallers',
                                    },
                                    limit: {
                                        type: 'integer',
                                        minimum: 1,
                                        description: 'Maximum number of results (default: 20).',
                                        example: 10,
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Matching symbols',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        matches: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    symbol: {
                                                        type: 'object',
                                                        properties: {
                                                            qualified_name: { type: 'string' },
                                                            symbol_type: { type: 'string' },
                                                        },
                                                    },
                                                    location: {
                                                        type: 'object',
                                                        properties: {
                                                            file_path: { type: 'string' },
                                                            start_line: { type: 'integer' },
                                                            end_line: { type: 'integer' },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: {
                        description: 'Validation error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ValidationError' },
                            },
                        },
                    },
                    401: {
                        description: 'Unauthorized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UnauthorizedError' },
                            },
                        },
                    },
                    500: {
                        description: 'Internal error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                },
            },
        },
        '/api/graph/export': {
            post: {
                summary: 'Export graph as Mermaid diagram',
                description:
                    'Exports the code graph (optionally rooted at a specific symbol) as a Mermaid ' +
                    'diagram string.',
                tags: ['Graph'],
                requestBody: {
                    required: false,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    root_qname: {
                                        type: 'string',
                                        description: 'Root symbol qualified name. Omit to export the whole graph.',
                                        example: 'MyModule.MyClass',
                                    },
                                    max_depth: {
                                        type: 'integer',
                                        minimum: 1,
                                        description: 'Maximum traversal depth from root.',
                                        example: 3,
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Mermaid diagram content',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        format: { type: 'string', example: 'mermaid' },
                                        content: { type: 'string', description: 'Mermaid diagram source.' },
                                    },
                                },
                            },
                        },
                    },
                    400: {
                        description: 'Validation error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ValidationError' },
                            },
                        },
                    },
                    401: {
                        description: 'Unauthorized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UnauthorizedError' },
                            },
                        },
                    },
                    500: {
                        description: 'Export failed',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorResponse' },
                            },
                        },
                    },
                },
            },
        },
    },
} as const;
