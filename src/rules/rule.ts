import { Rule } from "eslint";
import { Directive, VariableDeclaration } from "estree";

export function formatStyled(context: Rule.RuleContext): Rule.RuleListener {
  return {
    // once per file
    Program(node) {
      // get every VariableDeclaration in the file
      let allVariableDeclarations = node.body.filter(
        (node) => node.type === "VariableDeclaration"
      ) as VariableDeclaration[];

      const variableNames: string[] = [];
      const variableAST: Record<string, VariableDeclaration> = {};
      const variablePositions: Record<string, number> = {};
      const dependencies: Record<string, string[] | undefined> = {};

      allVariableDeclarations = allVariableDeclarations.filter((node) => {
        let init = node.declarations[0].init;
        return (
          "tag" in init &&
          (("callee" in init.tag &&
            "name" in init.tag.callee &&
            init.tag.callee.name === "styled") ||
            ("object" in init.tag &&
              "name" in init.tag.object &&
              init.tag.object.name === "styled"))
        );
      });

      // determining dependencies
      allVariableDeclarations.forEach((variableDeclaration, i) => {
        if (!("name" in variableDeclaration.declarations[0].id)) return;

        let nameOfVariable = variableDeclaration.declarations[0].id.name;
        variableNames.push(nameOfVariable);
        variableAST[nameOfVariable] = variableDeclaration;
        variablePositions[nameOfVariable] = i;

        // get all the dependencies of the variable
        variableDeclaration.declarations.forEach((declaration) => {
          if ("tag" in declaration.init && "arguments" in declaration.init.tag)
            declaration.init.tag.arguments.forEach((argument) => {
              if ("name" in argument) {
                if (!dependencies[nameOfVariable]) {
                  dependencies[nameOfVariable] = [];
                }
                dependencies[nameOfVariable].push(argument.name);
              }
            });

          if ("quasi" in declaration.init)
            declaration.init.quasi.expressions.forEach((expression) => {
              if ("name" in expression) {
                if (!dependencies[nameOfVariable]) {
                  dependencies[nameOfVariable] = [];
                }
                dependencies[nameOfVariable].push(expression.name);
              }
            });
        });
      });

      // get text of the node
      const sourceCode = context.getSourceCode();

      // determine the order the variables appear in the source, excluding their definitions
      let desiredOrder = variableNames.sort((a, b) => {
        let aIndex1 = sourceCode.getText().indexOf("<" + a + ">");
        let bIndex1 = sourceCode.getText().indexOf("<" + b + ">");
        let aIndex2 = sourceCode.getText().indexOf("<" + a + " ");
        let bIndex2 = sourceCode.getText().indexOf("<" + b + " ");

        if (aIndex1 === -1) aIndex1 = Infinity;
        if (bIndex1 === -1) bIndex1 = Infinity;
        if (aIndex2 === -1) aIndex2 = Infinity;
        if (bIndex2 === -1) bIndex2 = Infinity;

        let aIndex = Math.min(aIndex1, aIndex2);
        let bIndex = Math.min(bIndex1, bIndex2);

        if (aIndex === bIndex) return 0;
        return aIndex > bIndex ? 1 : -1;
      });

      // determine if any variables appear before their dependencies
      // if so, shift them down the array until they are after their dependencies
      const adjustOrder = () => {
        desiredOrder.forEach((variable, index) => {
          if (!dependencies[variable]) return;

          dependencies[variable].forEach((dependency) => {
            let dependencyIndex = desiredOrder.indexOf(dependency);
            if (dependencyIndex > index) {
              desiredOrder.splice(index, 1);
              desiredOrder.splice(dependencyIndex, 0, variable);
            }
          });
        });
      };

      // reorder the variables until they are in the correct order
      let lastOrder = "";
      while (lastOrder !== desiredOrder.join(", ")) {
        lastOrder = desiredOrder.join(", ");
        adjustOrder();
      }

      // check if the variables are in the correct order
      desiredOrder.forEach((variable, index) => {
        if (variablePositions[variable] < index) {
          context.report({
            node: variableAST[variable],
            message: `Declaration of ${variable} should be after ${
              desiredOrder[index - 1]
            }`,
            fix(fixer) {
              const nodeToMove = variableAST[variable];
              const nodeToReference = variableAST[desiredOrder[index - 1]];

              const textBetweenNodes = sourceCode
                .getText()
                .slice(nodeToMove.range[1], nodeToReference.range[0] - 1);

              // move nodeToMove until it is after nodeToReference
              return fixer.replaceTextRange(
                [nodeToMove.range[0], nodeToReference.range[1]],
                textBetweenNodes +
                  "\n" +
                  sourceCode.getText(nodeToReference) +
                  "\n" +
                  sourceCode.getText(nodeToMove)
              );
            },
          });
        }
      });
    },
  };
}
