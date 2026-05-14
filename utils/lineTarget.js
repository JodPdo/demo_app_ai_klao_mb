// แยก line_group_id "g:Uxxx" / "r:Rxxx" / "dm:Uxxx" → raw target id
// ใช้กับ pushMessage.to

function extractLineTarget(lineGroupId) {
  if (!lineGroupId) return null;
  const idx = lineGroupId.indexOf(":");
  return idx === -1 ? lineGroupId : lineGroupId.slice(idx + 1);
}

module.exports = { extractLineTarget };