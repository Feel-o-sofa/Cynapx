(function_definition 
    type: (_)? @function.return
    declarator: (function_declarator 
        declarator: (_) @function.name
        parameters: (parameter_list) @function.params
    )
) @function.def
(class_specifier name: (type_identifier) @class.name) @class.def
(struct_specifier name: (type_identifier) @class.name) @class.def

(base_class_clause [(type_identifier) (qualified_identifier)] @relation.inherits)

(namespace_definition name: (_) @module.name) @module.def
(call_expression function: (_) @call.name) @call.expr
(preproc_include path: (_) @import.name) @import.def
