(class_declaration 
    name: (type_identifier) @class.name) @class.def

(method_definition 
    name: (property_identifier) @method.name
    parameters: (formal_parameters) @method.params
    return_type: (type_annotation)? @method.return) @method.def

(function_declaration 
    name: (identifier) @function.name
    parameters: (formal_parameters) @function.params
    return_type: (type_annotation)? @function.return) @function.def

(extends_clause [(identifier) (member_expression)] @relation.inherits)
(implements_clause [(type_identifier) (nested_type_identifier)] @relation.implements)

(call_expression function: (identifier) @call.name) @call.expr
(import_statement source: (string) @import.name)
