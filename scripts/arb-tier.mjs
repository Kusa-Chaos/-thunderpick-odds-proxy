export function classifyArbTier(reciprocalSum,identityVerified=false){
  const sum=Number(reciprocalSum);
  if(!Number.isFinite(sum)||sum<=0||sum>1.03) return null;
  if(sum>1.01) return 'ARB SCREENING';
  if(sum<1&&identityVerified===true) return 'ARB FOUND';
  return 'ARB WATCH';
}
