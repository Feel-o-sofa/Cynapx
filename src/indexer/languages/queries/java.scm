(class_declaration name: (identifier) @class.name) @class.def
(interface_declaration name: (identifier) @interface.name) @interface.def
(method_declaration name: (identifier) @function.name parameters: (formal_parameters) @function.params) @function.def
(constructor_declaration name: (identifier) @function.name parameters: (formal_parameters) @function.params) @function.def

(superclass [(type_identifier) (scoped_type_identifier) (generic_type)] @relation.inherits)
(super_interfaces (type_list [(type_identifier) (scoped_type_identifier) (generic_type)] @relation.implements))
(extends_interfaces (type_list [(type_identifier) (scoped_type_identifier) (generic_type)] @relation.inherits))

(method_invocation name: (identifier) @call.name) @call.expr
(import_declaration [(scoped_identifier) (identifier)] @import.name) @import.def
