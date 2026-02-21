// Patch XPathExpression.evaluate for jsdom compatibility with htmx.
// htmx calls evaluate() without the required result type argument that jsdom expects.
// This must run BEFORE htmx is imported, hence it's a separate setup file.
const origEvaluate = XPathExpression.prototype.evaluate;
XPathExpression.prototype.evaluate = function (contextNode, type, result) {
  return origEvaluate.call(this, contextNode, type || XPathResult.ORDERED_NODE_ITERATOR_TYPE, result);
};
