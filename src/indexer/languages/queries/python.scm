(function_definition 
    name: (identifier) @function.name 
    parameters: (parameters) @function.params
    return_type: (type)? @function.return) @function.def
(class_definition 
    name: (identifier) @class.name
    (argument_list [(identifier) (attribute) (subscript)] @relation.inherits)?) @class.def
(call function: (identifier) @call.name) @call.expr
(import_statement) @import.stmt
(import_from_statement) @import.from_stmt
