import {THREAT_EXPRESSION,THREAT_PATTERN,threatDecision} from "./threat.mjs";
import {COOPERATION_EXPRESSION,COOPERATION_PATTERN,cooperationDecision} from "./cooperation.mjs";
export {THREAT_EXPRESSION,THREAT_PATTERN,COOPERATION_EXPRESSION,COOPERATION_PATTERN};
export function communicationDecision(sentence,{kind,...options}={}){
 if(kind==="threat")return threatDecision(sentence,options);
 if(kind==="cooperation")return cooperationDecision(sentence,options);
 throw Error("Unknown communication kind: "+kind);
}
