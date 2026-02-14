(function_declaration 
    name: (identifier) @function.name
    parameters: (parameter_list) @function.params
) @function.def
(method_declaration 
    name: (field_identifier) @method.name
    parameters: (parameter_list) @method.params
) @method.def
(type_spec name: (type_identifier) @class.name) @class.def
(call_expression function: [(identifier) (selector_expression field: (field_identifier))] @call.name) @call.expr
(import_spec path: (interpreted_string_literal) @import.name) @import.def
