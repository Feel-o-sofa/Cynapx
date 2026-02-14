(class_declaration (identifier) @class.name) @class.def
(interface_declaration (identifier) @interface.name) @interface.def
(method_declaration (identifier) @function.name parameters: (parameter_list) @function.params) @function.def

(base_list [(identifier) (qualified_name) (predefined_type) (generic_name)] @relation.inherits)

(invocation_expression function: [(identifier) (member_access_expression name: (identifier))] @call.name) @call.expr
(using_directive [(identifier) (qualified_name)] @import.name) @import.def
