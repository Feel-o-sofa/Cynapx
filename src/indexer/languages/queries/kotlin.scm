(class_declaration 
    [(type_identifier) (simple_identifier)] @class.name
    (delegation_specifier [(user_type) (constructor_invocation)] @relation.inherits)?
) @class.def
(function_declaration 
    (simple_identifier) @function.name
    (function_value_parameters) @function.params
) @function.def
(call_expression 
    [(navigation_expression (simple_identifier) @call.name) (simple_identifier) @call.name]
) @call.expr
(import_header (identifier) @import.name) @import.def
