(function_definition 
    declarator: (function_declarator 
        declarator: (identifier) @function.name
        parameters: (parameter_list) @function.params
    )
) @function.def
(struct_specifier name: (type_identifier) @class.name) @class.def
(enum_specifier name: (type_identifier) @class.name) @class.def
(call_expression function: (identifier) @call.name) @call.expr
(preproc_include path: [(string_literal) (system_lib_string)] @import.name) @import.def
