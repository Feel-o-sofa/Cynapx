(function_item 
    name: (identifier) @function.name
    parameters: (parameters) @function.params
) @function.def
(struct_item name: (type_identifier) @class.name) @class.def
(enum_item name: (type_identifier) @class.name) @class.def
(trait_item name: (type_identifier) @interface.name) @interface.def
(impl_item type: (_) @class.name) @class.def
(mod_item name: (identifier) @module.name) @module.def
(call_expression function: (_) @call.name) @call.expr
(use_declaration) @import.def
