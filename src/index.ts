import { formatStyled } from "./rules/rule";

module.exports = {
  rules: {
    "sort-styled-components": {
      create: formatStyled,
      meta: {
        fixable: "whitespace",
      },
    },
  },
};
