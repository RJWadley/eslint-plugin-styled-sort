import { Rule } from "eslint";
import { Expression, SpreadElement, VariableDeclaration } from "estree";

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
          // @ts-expect-error we lazy
          init?.tag?.callee?.name === "styled" ||
          // @ts-expect-error we lazy
          init?.tag?.object?.name === "styled" ||
          // @ts-expect-error we lazy
          init?.tag?.callee?.object?.object?.name === "styled" ||
          // @ts-expect-error we lazy
          init?.tag?.name === "css" ||
          // @ts-expect-error we lazy
          init?.tag?.name === "keyframes"
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
          if (
            declaration.init &&
            "tag" in declaration.init &&
            "arguments" in declaration.init.tag
          )
            declaration.init.tag.arguments.forEach((argument) => {
              if ("name" in argument) {
                if (!dependencies[argument.name]) {
                  dependencies[argument.name] = [];
                }
                dependencies[argument.name].push(nameOfVariable);
              }
            });

          const findDeps = (node: Expression | SpreadElement) => {
            if ("quasi" in node) {
              node.quasi.expressions.forEach((expression) => {
                if ("name" in expression) {
                  if (!dependencies[expression.name]) {
                    dependencies[expression.name] = [];
                  }
                  dependencies[expression.name].push(nameOfVariable);
                } else {
                  findDeps(expression);
                }
              });
            } else if ("arguments" in node) {
              node.arguments.forEach((argument) => {
                findDeps(argument);
              });
            }
          };

          findDeps(declaration.init);
        });
      });

      // get text of the node
      const sourceCode = context.getSourceCode();

      // determine the order the variables appear in the source, excluding their definitions
      let desiredOrder = variableNames.sort().sort((a, b) => {
        let aIndex1 = sourceCode.getText().indexOf("<" + a + ">");
        let bIndex1 = sourceCode.getText().indexOf("<" + b + ">");
        let aIndex2 = sourceCode.getText().indexOf("<" + a + " ");
        let bIndex2 = sourceCode.getText().indexOf("<" + b + " ");
        let aIndex3 = sourceCode.getText().indexOf("<" + a + "\n");
        let bIndex3 = sourceCode.getText().indexOf("<" + b + "\n");

        if (aIndex1 === -1) aIndex1 = Infinity;
        if (bIndex1 === -1) bIndex1 = Infinity;
        if (aIndex2 === -1) aIndex2 = Infinity;
        if (bIndex2 === -1) bIndex2 = Infinity;
        if (aIndex3 === -1) aIndex3 = Infinity;
        if (bIndex3 === -1) bIndex3 = Infinity;

        let aIndex = Math.min(aIndex1, aIndex2, aIndex3);
        let bIndex = Math.min(bIndex1, bIndex2, bIndex3);

        if (aIndex === bIndex) return 0;
        return aIndex > bIndex ? 1 : -1;
      });

      // determine if any variables appear after their dependencies
      // if so, shift them up the array until they are before their dependencies
      const adjustOrder = () => {
        desiredOrder.forEach((variable, index) => {
          if (!dependencies[variable]) return;
          let smallestDependencyIndex = Infinity;
          dependencies[variable].forEach((dependency) => {
            let dependencyIndex = desiredOrder.indexOf(dependency);
            if (dependencyIndex < smallestDependencyIndex)
              smallestDependencyIndex = dependencyIndex;
          });
          if (smallestDependencyIndex < index) {
            desiredOrder.splice(index, 1);
            desiredOrder.splice(smallestDependencyIndex, 0, variable);
          }
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
          let nodeToReportAt = variableAST[variable].declarations[0].id;

          context.report({
            node: nodeToReportAt,
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
                  "\n\n" +
                  sourceCode.getText(nodeToReference) +
                  "\n\n" +
                  sourceCode.getText(nodeToMove)
              );
            },
          });
        }
      });
    },
  };
}
