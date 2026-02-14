(class_declaration name: (name) @class.name) @class.def
(interface_declaration name: (name) @interface.name) @interface.def
(trait_declaration name: (name) @interface.name) @interface.def

(method_declaration name: (name) @method.name) @method.def
(function_definition name: (name) @function.name) @function.def

(base_clause (name) @relation.inherits)
(class_interface_clause (name) @relation.implements)
(use_declaration (name) @relation.inherits)

(function_call_expression (name) @call.name) @call.expr
