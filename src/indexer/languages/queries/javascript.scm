(function_declaration name: (identifier) @function.name) @function.def
(class_declaration name: (identifier) @class.name) @class.def
(method_definition name: (property_identifier) @method.name) @method.def
(call_expression function: (identifier) @call.name) @call.expr
(import_statement source: (string) @import.name)
