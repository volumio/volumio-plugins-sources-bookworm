const t=globalThis,e=t.ShadowRoot&&(void 0===t.ShadyCSS||t.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,i=Symbol(),s=new WeakMap;let a=class{constructor(t,e,s){if(this._$cssResult$=!0,s!==i)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=e}get styleSheet(){let t=this.o;const i=this.t;if(e&&void 0===t){const e=void 0!==i&&1===i.length;e&&(t=s.get(i)),void 0===t&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),e&&s.set(i,t))}return t}toString(){return this.cssText}};const o=(t,...e)=>{const s=1===t.length?t[0]:e.reduce((e,i,s)=>e+(t=>{if(!0===t._$cssResult$)return t.cssText;if("number"==typeof t)return t;throw Error("Value passed to 'css' function must be a 'css' function result: "+t+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(i)+t[s+1],t[0]);return new a(s,t,i)},r=e?t=>t:t=>t instanceof CSSStyleSheet?(t=>{let e="";for(const i of t.cssRules)e+=i.cssText;return(t=>new a("string"==typeof t?t:t+"",void 0,i))(e)})(t):t,{is:n,defineProperty:l,getOwnPropertyDescriptor:c,getOwnPropertyNames:d,getOwnPropertySymbols:u,getPrototypeOf:p}=Object,h=globalThis,m=h.trustedTypes,v=m?m.emptyScript:"",g=h.reactiveElementPolyfillSupport,b=(t,e)=>t,y={toAttribute(t,e){switch(e){case Boolean:t=t?v:null;break;case Object:case Array:t=null==t?t:JSON.stringify(t)}return t},fromAttribute(t,e){let i=t;switch(e){case Boolean:i=null!==t;break;case Number:i=null===t?null:Number(t);break;case Object:case Array:try{i=JSON.parse(t)}catch(t){i=null}}return i}},_=(t,e)=>!n(t,e),f={attribute:!0,type:String,converter:y,reflect:!1,useDefault:!1,hasChanged:_};Symbol.metadata??=Symbol("metadata"),h.litPropertyMetadata??=new WeakMap;let x=class extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??=[]).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,e=f){if(e.state&&(e.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((e=Object.create(e)).wrapped=!0),this.elementProperties.set(t,e),!e.noAccessor){const i=Symbol(),s=this.getPropertyDescriptor(t,i,e);void 0!==s&&l(this.prototype,t,s)}}static getPropertyDescriptor(t,e,i){const{get:s,set:a}=c(this.prototype,t)??{get(){return this[e]},set(t){this[e]=t}};return{get:s,set(e){const o=s?.call(this);a?.call(this,e),this.requestUpdate(t,o,i)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??f}static _$Ei(){if(this.hasOwnProperty(b("elementProperties")))return;const t=p(this);t.finalize(),void 0!==t.l&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(b("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(b("properties"))){const t=this.properties,e=[...d(t),...u(t)];for(const i of e)this.createProperty(i,t[i])}const t=this[Symbol.metadata];if(null!==t){const e=litPropertyMetadata.get(t);if(void 0!==e)for(const[t,i]of e)this.elementProperties.set(t,i)}this._$Eh=new Map;for(const[t,e]of this.elementProperties){const i=this._$Eu(t,e);void 0!==i&&this._$Eh.set(i,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){const e=[];if(Array.isArray(t)){const i=new Set(t.flat(1/0).reverse());for(const t of i)e.unshift(r(t))}else void 0!==t&&e.push(r(t));return e}static _$Eu(t,e){const i=e.attribute;return!1===i?void 0:"string"==typeof i?i:"string"==typeof t?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(t=>t(this))}addController(t){(this._$EO??=new Set).add(t),void 0!==this.renderRoot&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){const t=new Map,e=this.constructor.elementProperties;for(const i of e.keys())this.hasOwnProperty(i)&&(t.set(i,this[i]),delete this[i]);t.size>0&&(this._$Ep=t)}createRenderRoot(){const i=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return((i,s)=>{if(e)i.adoptedStyleSheets=s.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(const e of s){const s=document.createElement("style"),a=t.litNonce;void 0!==a&&s.setAttribute("nonce",a),s.textContent=e.cssText,i.appendChild(s)}})(i,this.constructor.elementStyles),i}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(t=>t.hostConnected?.())}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach(t=>t.hostDisconnected?.())}attributeChangedCallback(t,e,i){this._$AK(t,i)}_$ET(t,e){const i=this.constructor.elementProperties.get(t),s=this.constructor._$Eu(t,i);if(void 0!==s&&!0===i.reflect){const a=(void 0!==i.converter?.toAttribute?i.converter:y).toAttribute(e,i.type);this._$Em=t,null==a?this.removeAttribute(s):this.setAttribute(s,a),this._$Em=null}}_$AK(t,e){const i=this.constructor,s=i._$Eh.get(t);if(void 0!==s&&this._$Em!==s){const t=i.getPropertyOptions(s),a="function"==typeof t.converter?{fromAttribute:t.converter}:void 0!==t.converter?.fromAttribute?t.converter:y;this._$Em=s;const o=a.fromAttribute(e,t.type);this[s]=o??this._$Ej?.get(s)??o,this._$Em=null}}requestUpdate(t,e,i,s=!1,a){if(void 0!==t){const o=this.constructor;if(!1===s&&(a=this[t]),i??=o.getPropertyOptions(t),!((i.hasChanged??_)(a,e)||i.useDefault&&i.reflect&&a===this._$Ej?.get(t)&&!this.hasAttribute(o._$Eu(t,i))))return;this.C(t,e,i)}!1===this.isUpdatePending&&(this._$ES=this._$EP())}C(t,e,{useDefault:i,reflect:s,wrapped:a},o){i&&!(this._$Ej??=new Map).has(t)&&(this._$Ej.set(t,o??e??this[t]),!0!==a||void 0!==o)||(this._$AL.has(t)||(this.hasUpdated||i||(e=void 0),this._$AL.set(t,e)),!0===s&&this._$Em!==t&&(this._$Eq??=new Set).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}const t=this.scheduleUpdate();return null!=t&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(const[t,e]of this._$Ep)this[t]=e;this._$Ep=void 0}const t=this.constructor.elementProperties;if(t.size>0)for(const[e,i]of t){const{wrapped:t}=i,s=this[e];!0!==t||this._$AL.has(e)||void 0===s||this.C(e,void 0,i,s)}}let t=!1;const e=this._$AL;try{t=this.shouldUpdate(e),t?(this.willUpdate(e),this._$EO?.forEach(t=>t.hostUpdate?.()),this.update(e)):this._$EM()}catch(e){throw t=!1,this._$EM(),e}t&&this._$AE(e)}willUpdate(t){}_$AE(t){this._$EO?.forEach(t=>t.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&=this._$Eq.forEach(t=>this._$ET(t,this[t])),this._$EM()}updated(t){}firstUpdated(t){}};x.elementStyles=[],x.shadowRootOptions={mode:"open"},x[b("elementProperties")]=new Map,x[b("finalized")]=new Map,g?.({ReactiveElement:x}),(h.reactiveElementVersions??=[]).push("2.1.2");const w=globalThis,k=t=>t,$=w.trustedTypes,S=$?$.createPolicy("lit-html",{createHTML:t=>t}):void 0,C="$lit$",A=`lit$${Math.random().toFixed(9).slice(2)}$`,L="?"+A,E=`<${L}>`,M=document,V=()=>M.createComment(""),q=t=>null===t||"object"!=typeof t&&"function"!=typeof t,T=Array.isArray,P="[ \t\n\f\r]",I=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,H=/-->/g,z=/>/g,U=RegExp(`>|${P}(?:([^\\s"'>=/]+)(${P}*=${P}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,"g"),D=/'/g,Q=/"/g,B=/^(?:script|style|textarea|title)$/i,N=(t=>(e,...i)=>({_$litType$:t,strings:e,values:i}))(1),R=Symbol.for("lit-noChange"),O=Symbol.for("lit-nothing"),j=new WeakMap,F=M.createTreeWalker(M,129);function Z(t,e){if(!T(t)||!t.hasOwnProperty("raw"))throw Error("invalid template strings array");return void 0!==S?S.createHTML(e):e}const G=(t,e)=>{const i=t.length-1,s=[];let a,o=2===e?"<svg>":3===e?"<math>":"",r=I;for(let e=0;e<i;e++){const i=t[e];let n,l,c=-1,d=0;for(;d<i.length&&(r.lastIndex=d,l=r.exec(i),null!==l);)d=r.lastIndex,r===I?"!--"===l[1]?r=H:void 0!==l[1]?r=z:void 0!==l[2]?(B.test(l[2])&&(a=RegExp("</"+l[2],"g")),r=U):void 0!==l[3]&&(r=U):r===U?">"===l[0]?(r=a??I,c=-1):void 0===l[1]?c=-2:(c=r.lastIndex-l[2].length,n=l[1],r=void 0===l[3]?U:'"'===l[3]?Q:D):r===Q||r===D?r=U:r===H||r===z?r=I:(r=U,a=void 0);const u=r===U&&t[e+1].startsWith("/>")?" ":"";o+=r===I?i+E:c>=0?(s.push(n),i.slice(0,c)+C+i.slice(c)+A+u):i+A+(-2===c?e:u)}return[Z(t,o+(t[i]||"<?>")+(2===e?"</svg>":3===e?"</math>":"")),s]};class K{constructor({strings:t,_$litType$:e},i){let s;this.parts=[];let a=0,o=0;const r=t.length-1,n=this.parts,[l,c]=G(t,e);if(this.el=K.createElement(l,i),F.currentNode=this.el.content,2===e||3===e){const t=this.el.content.firstChild;t.replaceWith(...t.childNodes)}for(;null!==(s=F.nextNode())&&n.length<r;){if(1===s.nodeType){if(s.hasAttributes())for(const t of s.getAttributeNames())if(t.endsWith(C)){const e=c[o++],i=s.getAttribute(t).split(A),r=/([.?@])?(.*)/.exec(e);n.push({type:1,index:a,name:r[2],strings:i,ctor:"."===r[1]?tt:"?"===r[1]?et:"@"===r[1]?it:J}),s.removeAttribute(t)}else t.startsWith(A)&&(n.push({type:6,index:a}),s.removeAttribute(t));if(B.test(s.tagName)){const t=s.textContent.split(A),e=t.length-1;if(e>0){s.textContent=$?$.emptyScript:"";for(let i=0;i<e;i++)s.append(t[i],V()),F.nextNode(),n.push({type:2,index:++a});s.append(t[e],V())}}}else if(8===s.nodeType)if(s.data===L)n.push({type:2,index:a});else{let t=-1;for(;-1!==(t=s.data.indexOf(A,t+1));)n.push({type:7,index:a}),t+=A.length-1}a++}}static createElement(t,e){const i=M.createElement("template");return i.innerHTML=t,i}}function W(t,e,i=t,s){if(e===R)return e;let a=void 0!==s?i._$Co?.[s]:i._$Cl;const o=q(e)?void 0:e._$litDirective$;return a?.constructor!==o&&(a?._$AO?.(!1),void 0===o?a=void 0:(a=new o(t),a._$AT(t,i,s)),void 0!==s?(i._$Co??=[])[s]=a:i._$Cl=a),void 0!==a&&(e=W(t,a._$AS(t,e.values),a,s)),e}class Y{constructor(t,e){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=e}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){const{el:{content:e},parts:i}=this._$AD,s=(t?.creationScope??M).importNode(e,!0);F.currentNode=s;let a=F.nextNode(),o=0,r=0,n=i[0];for(;void 0!==n;){if(o===n.index){let e;2===n.type?e=new X(a,a.nextSibling,this,t):1===n.type?e=new n.ctor(a,n.name,n.strings,this,t):6===n.type&&(e=new st(a,this,t)),this._$AV.push(e),n=i[++r]}o!==n?.index&&(a=F.nextNode(),o++)}return F.currentNode=M,s}p(t){let e=0;for(const i of this._$AV)void 0!==i&&(void 0!==i.strings?(i._$AI(t,i,e),e+=i.strings.length-2):i._$AI(t[e])),e++}}class X{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,e,i,s){this.type=2,this._$AH=O,this._$AN=void 0,this._$AA=t,this._$AB=e,this._$AM=i,this.options=s,this._$Cv=s?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode;const e=this._$AM;return void 0!==e&&11===t?.nodeType&&(t=e.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,e=this){t=W(this,t,e),q(t)?t===O||null==t||""===t?(this._$AH!==O&&this._$AR(),this._$AH=O):t!==this._$AH&&t!==R&&this._(t):void 0!==t._$litType$?this.$(t):void 0!==t.nodeType?this.T(t):(t=>T(t)||"function"==typeof t?.[Symbol.iterator])(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==O&&q(this._$AH)?this._$AA.nextSibling.data=t:this.T(M.createTextNode(t)),this._$AH=t}$(t){const{values:e,_$litType$:i}=t,s="number"==typeof i?this._$AC(t):(void 0===i.el&&(i.el=K.createElement(Z(i.h,i.h[0]),this.options)),i);if(this._$AH?._$AD===s)this._$AH.p(e);else{const t=new Y(s,this),i=t.u(this.options);t.p(e),this.T(i),this._$AH=t}}_$AC(t){let e=j.get(t.strings);return void 0===e&&j.set(t.strings,e=new K(t)),e}k(t){T(this._$AH)||(this._$AH=[],this._$AR());const e=this._$AH;let i,s=0;for(const a of t)s===e.length?e.push(i=new X(this.O(V()),this.O(V()),this,this.options)):i=e[s],i._$AI(a),s++;s<e.length&&(this._$AR(i&&i._$AB.nextSibling,s),e.length=s)}_$AR(t=this._$AA.nextSibling,e){for(this._$AP?.(!1,!0,e);t!==this._$AB;){const e=k(t).nextSibling;k(t).remove(),t=e}}setConnected(t){void 0===this._$AM&&(this._$Cv=t,this._$AP?.(t))}}class J{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,e,i,s,a){this.type=1,this._$AH=O,this._$AN=void 0,this.element=t,this.name=e,this._$AM=s,this.options=a,i.length>2||""!==i[0]||""!==i[1]?(this._$AH=Array(i.length-1).fill(new String),this.strings=i):this._$AH=O}_$AI(t,e=this,i,s){const a=this.strings;let o=!1;if(void 0===a)t=W(this,t,e,0),o=!q(t)||t!==this._$AH&&t!==R,o&&(this._$AH=t);else{const s=t;let r,n;for(t=a[0],r=0;r<a.length-1;r++)n=W(this,s[i+r],e,r),n===R&&(n=this._$AH[r]),o||=!q(n)||n!==this._$AH[r],n===O?t=O:t!==O&&(t+=(n??"")+a[r+1]),this._$AH[r]=n}o&&!s&&this.j(t)}j(t){t===O?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}}class tt extends J{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===O?void 0:t}}class et extends J{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==O)}}class it extends J{constructor(t,e,i,s,a){super(t,e,i,s,a),this.type=5}_$AI(t,e=this){if((t=W(this,t,e,0)??O)===R)return;const i=this._$AH,s=t===O&&i!==O||t.capture!==i.capture||t.once!==i.once||t.passive!==i.passive,a=t!==O&&(i===O||s);s&&this.element.removeEventListener(this.name,this,i),a&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){"function"==typeof this._$AH?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}}class st{constructor(t,e,i){this.element=t,this.type=6,this._$AN=void 0,this._$AM=e,this.options=i}get _$AU(){return this._$AM._$AU}_$AI(t){W(this,t)}}const at=w.litHtmlPolyfillSupport;at?.(K,X),(w.litHtmlVersions??=[]).push("3.3.2");const ot=globalThis;let rt=class extends x{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){const t=super.createRenderRoot();return this.renderOptions.renderBefore??=t.firstChild,t}update(t){const e=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=((t,e,i)=>{const s=i?.renderBefore??e;let a=s._$litPart$;if(void 0===a){const t=i?.renderBefore??null;s._$litPart$=a=new X(e.insertBefore(V(),t),t,void 0,i??{})}return a._$AI(t),a})(e,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return R}};rt._$litElement$=!0,rt.finalized=!0,ot.litElementHydrateSupport?.({LitElement:rt});const nt=ot.litElementPolyfillSupport;nt?.({LitElement:rt}),(ot.litElementVersions??=[]).push("4.2.2");const lt=o`
  /* ── Quality tier colors ──────────────────────────────────── */
  :host {
    --volumio-quality-hires: #D4A017;
    --volumio-quality-hires-bg: rgba(212, 160, 23, 0.12);
    --volumio-quality-lossless: #00ACC1;
    --volumio-quality-lossless-bg: rgba(0, 172, 193, 0.12);
    --volumio-quality-lossy: #9E9E9E;
    --volumio-quality-lossy-bg: rgba(158, 158, 158, 0.08);
    --volumio-quality-basic: #616161;
    --volumio-quality-stream: #42A5F5;
    --volumio-quality-stream-bg: rgba(66, 165, 245, 0.12);

    /* ── Layout dimensions ────────────────────────────────── */
    --volumio-nav-width-pinned: 240px;
    --volumio-nav-width-collapsed: 56px;
    --volumio-queue-width: 320px;
    --volumio-topbar-height: 48px;
    --volumio-breadcrumb-height: 32px;
    --volumio-player-bar-height: 80px;

    /* ── Spacing scale (4px grid) ─────────────────────────── */
    --volumio-space-xs: 4px;
    --volumio-space-sm: 8px;
    --volumio-space-md: 16px;
    --volumio-space-lg: 24px;
    --volumio-space-xl: 32px;
    --volumio-space-xxl: 48px;

    /* ── Now Playing ──────────────────────────────────────── */
    --volumio-now-playing-bg: var(--primary-background-color, #000000);
  }

  /* ── Reduced motion ─────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }

  /* ── Focus indicators (accessibility) ───────────────────── */
  :focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
  }

  /* ── Common utility classes ─────────────────────────────── */
  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`,ct=new Set(["flac","alac","wav","aiff","ape","wv","wavpack","dsf","dff","dsd"]),dt=new Set(["mp3","ogg","aac","opus","vorbis","wma","m4a"]),ut=new Set(["qobuz","tidal","spotify","spop","pandora","youtube","youtube2","webradio","mpd","upnp","airplay","snapcast","bluetooth"]);function pt({trackType:t,samplerate:e,bitdepth:i,bitrate:s,isStream:a}){const o=(r=t)?String(r).trim().toLowerCase().replace(/\s+/g,""):"";var r;const n=function(t){if(null==t)return null;if("number"==typeof t)return t;const e=String(t).trim().toLowerCase().match(/([\d.]+)/);if(!e)return null;const i=parseFloat(e[1]);return i>1e3?i/1e3:i}(e),l=function(t){if(null==t)return null;if("number"==typeof t)return t;const e=String(t).trim().match(/(\d+)/);return e?parseInt(e[1],10):null}(i),c=function(t){if(null==t)return null;if("number"==typeof t)return t;const e=String(t).trim().match(/([\d.]+)/);return e?parseFloat(e[1]):null}(s),d=ut.has(o)?"":o,u=ct.has(d),p=dt.has(d);if(a){return ht("stream",d?`${d.toUpperCase()}${c?` ${Math.round(c)}`:""}`:"STREAM","STREAM","var(--volumio-quality-stream)","var(--volumio-quality-stream-bg, rgba(66, 165, 245, 0.12))")}if(u&&(null!=l&&l>16||null!=n&&n>44.1))return ht("hires",yt(d,l,n),"HI-RES","var(--volumio-quality-hires)","var(--volumio-quality-hires-bg, rgba(212, 160, 23, 0.12))");if(u)return ht("lossless",yt(d,l,n),"LOSSLESS","var(--volumio-quality-lossless)","var(--volumio-quality-lossless-bg, rgba(0, 172, 193, 0.12))");if(!p&&(null!=l||null!=n)){if(null!=l&&l>16||null!=n&&n>44.1){return ht("hires",yt(d||"HI-RES",l,n),"HI-RES","var(--volumio-quality-hires)","var(--volumio-quality-hires-bg, rgba(212, 160, 23, 0.12))")}return ht("lossless",yt(d||"LOSSLESS",l,n),"LOSSLESS","var(--volumio-quality-lossless)","var(--volumio-quality-lossless-bg, rgba(0, 172, 193, 0.12))")}if(p){if(null!=c&&c<256)return ht("basic",`${d.toUpperCase()} ${Math.round(c)}`,"BASIC","var(--volumio-quality-basic, #616161)","rgba(97, 97, 97, 0.08)");return ht("high",d?`${d.toUpperCase()}${c?` ${Math.round(c)}`:""}`:"HIGH","HIGH","var(--volumio-quality-lossy)","var(--volumio-quality-lossy-bg, rgba(158, 158, 158, 0.08))")}return d&&null!=c?c<256?ht("basic",`${Math.round(c)} kbps`,"BASIC","var(--volumio-quality-basic, #616161)","rgba(97, 97, 97, 0.08)"):ht("high",`${Math.round(c)} kbps`,"HIGH","var(--volumio-quality-lossy)","var(--volumio-quality-lossy-bg, rgba(158, 158, 158, 0.08))"):ht("unknown","","","var(--secondary-text-color)","transparent")}function ht(t,e,i,s,a){return{tier:t,label:e,tierLabel:i,color:s,colorBg:a}}const mt=new Set(["qobuz","tidal"]),vt=new Set(["spotify","spop","youtube","youtube2","ytmusic"]),gt=new Set(["webradio","pandora"]);function bt(t){const e=t.trackType||t.tracktype,i=e?String(e).trim().toLowerCase():"",s=ut.has(i);if(null!=t.samplerate||null!=t.bitdepth||null!=t.bitrate||e&&!s)return pt({trackType:e,samplerate:t.samplerate,bitdepth:t.bitdepth,bitrate:t.bitrate,isStream:!1});const a=(t.uri||"").toLowerCase(),o=(t.service||(s?i:"")).toLowerCase();let r="";const n=a.match(/\.([a-z0-9]+)(?:[?#]|$)/);if(n){const t=n[1];["flac","alac","wav","aiff","aif","ape","wv","dsf","dff","dsd"].includes(t)||["mp3","ogg","opus","aac","wma"].includes(t)?r=t:"m4a"===t&&(r="aac")}return r||(mt.has(o)?r="flac":vt.has(o)&&(r="ogg")),pt({trackType:r,samplerate:null,bitdepth:null,bitrate:null,isStream:gt.has(o)})}function yt(t,e,i){const s=t.toUpperCase();return e&&i?`${s} ${e}/${i}`:e?`${s} ${e}-bit`:i?`${s} ${i}kHz`:s}function _t(t){if(!t||t<=0)return"0:00";const e=Math.floor(t),i=Math.floor(e/3600),s=Math.floor(e%3600/60),a=e%60;return i>0?`${i}:${s.toString().padStart(2,"0")}:${a.toString().padStart(2,"0")}`:`${s}:${a.toString().padStart(2,"0")}`}function ft(t){const e=(new TextEncoder).encode(t);let i="";for(let t=0;t<e.length;t++)i+=String.fromCharCode(e[t]);return btoa(i).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}function xt(t,e,i){if(!t)return"";if(/\s/.test(t))return"";if(/^[a-z][a-z0-9+.-]*:/i.test(t)&&!/^https?:\/\//i.test(t))return"";if(/^\/api\//.test(t))return t;if(/^https:\/\//i.test(t))return t;if(/^http:\/\//i.test(t)){if(i&&e&&t.startsWith(e)){const s=t.substring(e.length);return`/api/volumio_ws/art?entry=${encodeURIComponent(i)}&path=${ft(s)}`}return t}return i?`/api/volumio_ws/art?entry=${encodeURIComponent(i)}&path=${ft(t)}`:e&&!/^https?:\/\//i.test(e)?"":e?`${e}${t}`:t}function wt(t,e=""){try{const i=localStorage.getItem(t);return null==i?e:i}catch{return e}}function kt(t,e){try{return localStorage.setItem(t,e),!0}catch{return!1}}const $t="volumio-selected-device";function St(t){try{t?localStorage.setItem($t,t):localStorage.removeItem($t)}catch{}}class Ct{constructor(){this._hass=null,this._panel=null,this._devices=[],this._activeDevice=null,this._entityId=null,this._configEntryId=null,this._sensorBase=null,this._queueUnsub=null,this._lastState=null,this._stateListeners=new Set,this._queueListeners=new Set,this._devicesListeners=new Set,this._initInFlight=null}connect({hass:t,panel:e}){this._hass=t,this._panel=e,this._initInFlight=this._initDevices()}updateHass(t,e){this._hass=t,void 0!==e&&(this._panel=e);const i=this._normalize();(function(t,e){if(!t||!e)return!0;const i=Object.keys(e).filter(t=>"_raw"!==t);return i.some(i=>t[i]!==e[i])})(this._lastState,i)&&(this._lastState=i,this._fireState(i))}disconnect(){this._unsubscribeQueue(),this._stateListeners.clear(),this._queueListeners.clear(),this._devicesListeners.clear()}getState(){return this._normalize()}getVolumioUrl(){return this._activeDevice?.volumio_url||""}getSensorValue(t){return this.getState()[t]||null}get ready(){return!(!this._entityId||!this._configEntryId)}get entityId(){return this._entityId}getDevices(){return this._devices.slice()}getActiveDeviceId(){return this._configEntryId}getActiveDevice(){return this._activeDevice}async setDevice(t){const e=this._devices.find(e=>e.config_entry_id===t);if(!e)return void console.warn("[ha-adapter] setDevice: unknown device",t);if(e.config_entry_id===this._configEntryId)return;St(e.config_entry_id),this._unsubscribeQueue(),this._applyDevice(e),this._lastState=null,this._fireDevices();const i=this._normalize();this._lastState=i,this._fireState(i),await this._subscribeQueue()}async refreshDevices(){this._configEntryId;await this._initDevices(),this._configEntryId}onDevicesChange(t){this._devicesListeners.add(t)}offDevicesChange(t){this._devicesListeners.delete(t)}async call(t,e={}){if(!this._hass||!this._configEntryId)throw new Error(`Adapter not ready: call(${t})`);return await this._hass.connection.sendMessagePromise({type:"call_service",domain:"volumio_ws",service:t,service_data:{config_entry_id:this._configEntryId,...e},return_response:!0})}async callMethod(t,e,i){return console.warn(`[ha-adapter] callMethod not supported in HA mode (${e}/${i})`),{response:{success:!1,command:"callMethod",error:"not_supported_in_ha"}}}async play(){await this._mediaPlayerCall("media_play")}async pause(){await this._mediaPlayerCall("media_pause")}async playPause(){"playing"===this.getState().state?await this.pause():await this.play()}async stop(){await this._mediaPlayerCall("media_stop")}async next(){await this._mediaPlayerCall("media_next_track")}async prev(){await this._mediaPlayerCall("media_previous_track")}async seek(t){await this._mediaPlayerCall("media_seek",{seek_position:t})}async setVolume(t){this.getState().volumeEnabled&&await this._mediaPlayerCall("set_volume_level",{volume_level:t/100})}async mute(t){this.getState().volumeEnabled&&await this._mediaPlayerCall("volume_mute",{is_volume_muted:t})}async toggleMute(){const t=this.getState();await this.mute(!t.muted)}async setShuffle(t){await this._mediaPlayerCall("shuffle_set",{shuffle:t})}async setRepeat(t){await this._mediaPlayerCall("repeat_set",{repeat:t})}onQueueChange(t){this._queueListeners.add(t)}offQueueChange(t){this._queueListeners.delete(t)}onStateChange(t){this._stateListeners.add(t)}offStateChange(t){this._stateListeners.delete(t)}async _fetchPluginEndpoint(t,e){if(!this._configEntryId)return null;try{const i=await this.call("plugin_endpoint",{endpoint:t,data:e}),s=i?.response;return s&&!1!==s.success?s.data:null}catch{return null}}async fetchArtistBio(t){if(!t)return null;const e=await this._fetchPluginEndpoint("metavolumio",{mode:"storyArtist",artist:t});return e&&!1!==e.success&&e.value&&"string"==typeof e.value?e.value:null}async fetchSimilarArtists(t){if(!t)return[];const e=await this._fetchPluginEndpoint("getSimilarArtists",{artist:t});return Array.isArray(e)?e:[]}async fetchAlbumStory(t,e){if(!t||!e)return null;const i=await this._fetchPluginEndpoint("metavolumio",{mode:"storyAlbum",artist:t,album:e});return i&&!1!==i.success&&i.value&&"string"==typeof i.value?i.value:null}async fetchAlbumCredits(t,e){if(!t||!e)return[];const i=await this._fetchPluginEndpoint("metavolumio",{mode:"creditsAlbum",artist:t,album:e});return i&&!1!==i.success&&Array.isArray(i.value)?i.value:[]}_normalize(){return function(t,e,i){if(!t)return{state:"unavailable",title:"",artist:"",album:"",albumArt:"",duration:0,position:0,positionUpdatedAt:"",volume:0,muted:!1,shuffle:!1,repeat:"off",source:"",uri:"",queuePosition:-1,volumeEnabled:!1,bitrate:null,_raw:{}};const s=t.attributes||{},a=s.supported_features||0,o={};if(e&&i){const t={trackType:"track_type",samplerate:"sample_rate",bitdepth:"bit_depth",channels:"channels"};for(const[s,a]of Object.entries(t)){const t=`sensor.${e}_${a}`,r=i.states?.[t];o[s]="unknown"!==r?.state&&"unavailable"!==r?.state?r.state:null}}return{state:t.state||"unavailable",title:s.media_title||"",artist:s.media_artist||"",album:s.media_album_name||"",albumArt:s.entity_picture||"",rawAlbumart:s.albumart||"",duration:s.media_duration||0,position:s.media_position||0,positionUpdatedAt:s.media_position_updated_at||"",volume:null!=s.volume_level?Math.round(100*s.volume_level):0,muted:s.is_volume_muted||!1,shuffle:s.shuffle||!1,repeat:s.repeat||"off",source:s.source||"",uri:s.uri||"",queuePosition:s.queue_position??-1,volumeEnabled:!!(4&a),bitrate:s.bitrate||null,trackType:o.trackType||null,samplerate:o.samplerate||null,bitdepth:o.bitdepth||null,channels:o.channels||null,_raw:s}}(this._entityId?this._hass?.states?.[this._entityId]:null,this._sensorBase,this._hass)}_applyDevice(t){if(!t)return this._activeDevice=null,this._configEntryId=null,this._entityId=null,void(this._sensorBase=null);this._activeDevice=t,this._configEntryId=t.config_entry_id,this._entityId=t.entity_id||null,this._sensorBase=t.entity_id?t.entity_id.replace("media_player.",""):null}async _initDevices(){if(!this._hass)return;let t=[];try{const e=await this._hass.connection.sendMessagePromise({type:"volumio_ws/list_devices"});t=Array.isArray(e?.devices)?e.devices:[]}catch(t){return console.error("[ha-adapter] list_devices failed:",t),this._devices=[],this._applyDevice(null),void this._fireDevices()}this._devices=t;const e=function(){try{return localStorage.getItem($t)}catch{return null}}();let i=t.find(t=>t.config_entry_id===e);!i&&t.length>0&&(i=t[0]),e&&!t.some(t=>t.config_entry_id===e)&&St(null);const s=this._configEntryId;this._applyDevice(i||null),this._configEntryId!==s&&(this._unsubscribeQueue(),this._configEntryId&&await this._subscribeQueue());const a=this._normalize();this._lastState=a,this._fireState(a),this._fireDevices()}async _subscribeQueue(){if(this._queueUnsub||!this._hass||!this._configEntryId)return;const t=this._configEntryId;try{this._queueUnsub=await this._hass.connection.subscribeMessage(t=>{t.queue&&this._notifyQueue([...t.queue])},{type:"volumio_ws/subscribe_queue",config_entry_id:t})}catch(t){console.warn("[ha-adapter] Queue subscription failed:",t)}try{const t=await this.call("queue_get");t?.response?.queue&&this._notifyQueue([...t.response.queue])}catch{}}_unsubscribeQueue(){this._queueUnsub&&("function"==typeof this._queueUnsub&&this._queueUnsub(),this._queueUnsub=null)}_notifyQueue(t){for(const e of this._queueListeners)try{e(t)}catch(t){console.error("[ha-adapter] Queue listener error:",t)}}_fireState(t){for(const e of this._stateListeners)try{e(t)}catch(t){console.error("[ha-adapter] State listener error:",t)}}_fireDevices(){const t={devices:this._devices.slice(),activeId:this._configEntryId};for(const e of this._devicesListeners)try{e(t)}catch(t){console.error("[ha-adapter] Devices listener error:",t)}}async _mediaPlayerCall(t,e={}){if(!this._hass||!this._entityId)throw new Error(`Adapter not ready: media_player.${t}`);return await this._hass.callService("media_player",t,{entity_id:this._entityId,...e})}}const At="local";function Lt(t){switch(t){case"play":return"playing";case"pause":return"paused";case"stop":return"idle";case void 0:case null:case"":return"unavailable";default:return t}}function Et(t,e){return t?t.startsWith("http://")||t.startsWith("https://")?t:`${e}${t}`:""}function Mt(t,e){return t&&"object"==typeof t?{state:Lt(t.status),title:t.title||"",artist:t.artist||"",album:t.album||"",albumArt:Et(t.albumart,e),rawAlbumart:t.albumart||"",duration:t.duration||0,position:"number"==typeof t.seek?t.seek/1e3:0,positionUpdatedAt:t._receivedAt||"",volume:"number"==typeof t.volume?t.volume:0,muted:!!t.mute,shuffle:!!t.random,repeat:(i=t.repeat,s=t.repeatSingle,s?"one":i?"all":"off"),source:t.service||"",uri:t.uri||"",queuePosition:"number"==typeof t.position?t.position:-1,volumeEnabled:!t.disableVolumeControl,bitrate:t.bitrate||null,trackType:t.trackType||null,samplerate:t.samplerate||null,bitdepth:t.bitdepth||null,channels:t.channels??null,_raw:t}:{state:"unavailable",title:"",artist:"",album:"",albumArt:"",rawAlbumart:"",duration:0,position:0,positionUpdatedAt:"",volume:0,muted:!1,shuffle:!1,repeat:"off",source:"",uri:"",queuePosition:-1,volumeEnabled:!1,bitrate:null,trackType:null,samplerate:null,bitdepth:null,channels:null,_raw:{}};var i,s}class Vt{constructor(){this._host="",this._port=3e3,this._baseUrl="",this._ws=null,this._handshakeComplete=!1,this._firstPushStateReceived=!1,this._sid=null,this._pingIntervalMs=25e3,this._pingTimeoutMs=5e3,this._pingTimer=null,this._pongTimer=null,this._shuttingDown=!1,this._reconnectAttempts=0,this._reconnectTimer=null,this._connectResolve=null,this._connectReject=null,this._connectTimer=null,this._state=null,this._queue=[],this._browseSources=[],this._lastState=null,this._stateListeners=new Set,this._queueListeners=new Set,this._devicesListeners=new Set,this._pendingResponses=new Map}async connect({host:t,port:e}={}){return this._host=t||window.location.hostname,this._port=e||3e3,this._baseUrl=`http://${this._host}:${this._port}`,this._shuttingDown=!1,this._reconnectAttempts=0,this._open()}async disconnect(){if(this._shuttingDown=!0,this._clearTimers(),this._failPendingConnect(new Error("disconnected")),this._ws){try{this._ws.close()}catch{}this._ws=null}this._handshakeComplete=!1,this._stateListeners.clear(),this._queueListeners.clear(),this._devicesListeners.clear();for(const[t,e]of this._pendingResponses)for(const t of e)t.timer&&clearTimeout(t.timer),t.resolve(null);this._pendingResponses.clear()}getState(){return Mt(this._state,this._baseUrl)}getVolumioUrl(){return this._baseUrl}getSensorValue(t){return this.getState()[t]||null}get ready(){return this._handshakeComplete&&this._firstPushStateReceived}get entityId(){return null}getDevices(){return[{config_entry_id:At,name:"Volumio",host:this._host,port:this._port,volumio_url:this._baseUrl,entity_id:null}]}getActiveDeviceId(){return At}getActiveDevice(){return this.getDevices()[0]}async setDevice(){}async refreshDevices(){}onDevicesChange(t){this._devicesListeners.add(t)}offDevicesChange(t){this._devicesListeners.delete(t)}async call(t,e={}){switch(t){case"get_browse_sources":return{response:{sources:await this._emitAndWait("getBrowseSources",null,"getBrowseSources")||[]}};case"browse":{const t=e.uri?{uri:e.uri}:null;return{response:await this._emitAndWait("browseLibrary",t,"browseLibrary:browse")||{}}}case"search":return{response:await this._emitAndWait("search",{value:e.query},"browseLibrary:search")||{}};case"queue_get":return{response:{queue:await this._emitAndWait("getQueue",null,"getQueue")||[]}};case"queue_add":return this._fireAndAck("addToQueue",e);case"queue_remove":return this._fireAndAck("removeFromQueue",{value:e.index});case"queue_move":return this._fireAndAck("moveQueue",{from:e.from_index,to:e.to_index});case"queue_clear":return this._fireAndAck("clearQueue");case"queue_play_index":return this._fireAndAck("play",{value:e.index});case"replace_and_play":return this._fireAndAck("replaceAndPlay",e);case"save_queue_to_playlist":return this._fireAndAck("saveQueueToPlaylist",{name:e.name});case"playlist_list":return{response:{playlists:await this._emitAndWait("listPlaylist",null,"listPlaylist")||[]}};case"playlist_create":return this._fireAndAck("createPlaylist",{name:e.name});case"playlist_delete":return this._fireAndAck("deletePlaylist",{name:e.name});case"playlist_add_track":return this._fireAndAck("addToPlaylist",this._playlistTrackPayload(e));case"playlist_remove_track":return this._fireAndAck("removeFromPlaylist",this._playlistTrackPayload(e));case"playlist_play":return this._fireAndAck("playPlaylist",{name:e.name});case"playlist_enqueue":return this._fireAndAck("enqueue",{name:e.name});case"favorites_list":{const t=await this._emitAndWait("browseLibrary",{uri:"favourites"},"browseLibrary:browse"),e=t?.navigation?.lists||[],i=[];for(const t of e)Array.isArray(t?.items)&&i.push(...t.items);return{response:{items:i}}}case"favorites_add":return this._fireAndAck("addToFavourites",e);case"favorites_remove":return this._fireAndAck("removeFromFavourites",e);case"plugin_endpoint":return{response:await this._fetchPluginEndpoint(e.endpoint,e.data)||{success:!1,error:"fetch_failed"}};default:return console.warn("[volumio-adapter] Unknown service:",t),{response:{success:!1,error:`unknown_service:${t}`}}}}async callMethod(t,e,i,s){const a={type:t,endpoint:e,method:i};null!=s&&(a.data=s);return await this._emit("callMethod",a)?{response:{success:!0,command:"callMethod"}}:{response:{success:!1,command:"callMethod",error:"not_connected"}}}_playlistTrackPayload(t){const e={name:t.name,uri:t.uri};return null!=t.service&&(e.service=t.service),e}async _fireAndAck(t,e){return await this._emit(t,e)?{response:{success:!0,command:t}}:{response:{success:!1,command:t,error:"not_connected"}}}async play(){await this._emit("play")}async pause(){await this._emit("pause")}async playPause(){"playing"===this.getState().state?await this.pause():await this.play()}async stop(){await this._emit("stop")}async next(){await this._emit("next")}async prev(){await this._emit("prev")}async seek(t){await this._emit("seek",Math.floor(t))}async setVolume(t){this.getState().volumeEnabled&&await this._emit("volume",Math.max(0,Math.min(100,Math.round(t))))}async mute(t){this.getState().volumeEnabled&&await this._emit(t?"mute":"unmute")}async toggleMute(){await this.mute(!this.getState().muted)}async setShuffle(t){await this._emit("setRandom",{value:!!t})}async setRepeat(t){if("one"===t)return console.warn("[volumio-adapter] setRepeat('one') not supported (no WS command for repeatSingle)"),void await this._emit("setRepeat",{value:!1});await this._emit("setRepeat",{value:"all"===t})}onStateChange(t){this._stateListeners.add(t)}offStateChange(t){this._stateListeners.delete(t)}onQueueChange(t){this._queueListeners.add(t)}offQueueChange(t){this._queueListeners.delete(t)}async _fetchPluginEndpoint(t,e){try{const i=await fetch(`${this._baseUrl}/api/v1/pluginEndpoint`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:t,data:e})});if(!i.ok)return null;const s=await i.json();return s&&!1!==s.success?s.data:null}catch{return null}}async fetchArtistBio(t){if(!t)return null;const e=await this._fetchPluginEndpoint("metavolumio",{mode:"storyArtist",artist:t});return e&&!1!==e.success&&e.value&&"string"==typeof e.value?e.value:null}async fetchSimilarArtists(t){if(!t)return[];const e=await this._fetchPluginEndpoint("getSimilarArtists",{artist:t});return Array.isArray(e)?e:[]}async fetchAlbumStory(t,e){if(!t||!e)return null;const i=await this._fetchPluginEndpoint("metavolumio",{mode:"storyAlbum",artist:t,album:e});return i&&!1!==i.success&&i.value&&"string"==typeof i.value?i.value:null}async fetchAlbumCredits(t,e){if(!t||!e)return[];const i=await this._fetchPluginEndpoint("metavolumio",{mode:"creditsAlbum",artist:t,album:e});return i&&!1!==i.success&&Array.isArray(i.value)?i.value:[]}_open(){return new Promise((t,e)=>{const i=`ws://${this._host}:${this._port}/socket.io/?EIO=3&transport=websocket`;let s;try{s=new WebSocket(i)}catch(t){return void e(t)}this._ws=s,this._handshakeComplete=!1,this._connectResolve=t,this._connectReject=e,this._connectTimer=setTimeout(()=>{if(this._handshakeComplete)return;const t=`EIO3 handshake to ${this._host}:${this._port} timed out after 15000ms`;console.warn("[volumio-adapter]",t);try{s.close()}catch{}this._failPendingConnect(new Error(t))},15e3),s.addEventListener("message",t=>{"string"==typeof t.data&&this._onMessage(t.data)}),s.addEventListener("error",t=>{console.warn("[volumio-adapter] WebSocket error:",t)}),s.addEventListener("close",()=>{this._handleConnectionLost()})})}_onMessage(t){if(!t)return;const e=t[0];if("0"!==e)if("40"!==t)if("3"!==e){if("2"!==e)return"4"===e?"2"===t[1]?void this._dispatchEvent(t):"1"===t[1]?void this._handleConnectionLost():void 0:void("1"!==e||this._handleConnectionLost());this._sendRaw("3")}else this._pongTimer&&(clearTimeout(this._pongTimer),this._pongTimer=null);else this._onHandshakeAck();else this._parseOpenPacket(t)}_parseOpenPacket(t){try{const e=JSON.parse(t.slice(1));this._sid=e.sid||null,this._pingIntervalMs=e.pingInterval||25e3,this._pingTimeoutMs=e.pingTimeout||5e3}catch(t){console.warn("[volumio-adapter] Failed to parse EIO3 Open packet:",t)}}_onHandshakeAck(){if(this._handshakeComplete=!0,this._reconnectAttempts=0,this._connectTimer&&(clearTimeout(this._connectTimer),this._connectTimer=null),this._connectResolve){const t=this._connectResolve;this._connectResolve=null,this._connectReject=null,t()}this._startPingLoop(),this._emit("getState"),this._emit("getBrowseSources")}_dispatchEvent(t){let e;try{e=JSON.parse(t.slice(2))}catch{return void console.warn("[volumio-adapter] Failed to parse SIO event JSON")}if(!Array.isArray(e)||e.length<1)return;const i=e[0],s=e.length>1?e[1]:null;switch(i){case"pushState":this._onPushState(s);break;case"pushQueue":this._onPushQueue(s);break;case"pushBrowseSources":this._onPushBrowseSources(s);break;case"pushListPlaylist":this._resolvePending("listPlaylist",Array.isArray(s)?s:[]);break;case"pushBrowseLibrary":this._onPushBrowseLibrary(s);break;case"pushMethod":this._resolvePending("callMethod",s)}}_onPushState(t){if(!t||"object"!=typeof t)return;t._receivedAt=(new Date).toISOString(),this._state=t,this._firstPushStateReceived=!0;const e=Mt(this._state,this._baseUrl);(function(t,e){if(!t||!e)return!0;const i=Object.keys(e).filter(t=>"_raw"!==t);return i.some(i=>t[i]!==e[i])})(this._lastState,e)&&(this._lastState=e,this._fireState(e))}_onPushQueue(t){const e=Array.isArray(t)?t:[];this._queue=e,this._resolvePending("getQueue",e),this._notifyQueue(e)}_onPushBrowseSources(t){this._browseSources=Array.isArray(t)?t:[],this._resolvePending("getBrowseSources",this._browseSources)}_onPushBrowseLibrary(t){const e=!!t?.navigation?.isSearchResult?"browseLibrary:search":"browseLibrary:browse";this._resolvePending(e,t)}async _emit(t,e){if(!this._ws||this._ws.readyState!==WebSocket.OPEN||!this._handshakeComplete)return console.warn(`[volumio-adapter] Cannot emit '${t}': not connected`),!1;const i=null!=e?JSON.stringify([t,e]):JSON.stringify([t]);return this._sendRaw(`42${i}`)}_sendRaw(t){try{return this._ws.send(t),!0}catch(t){return console.warn("[volumio-adapter] send failed:",t),!1}}async _emitAndWait(t,e,i,s=1e4){if(!this._ws||this._ws.readyState!==WebSocket.OPEN||!this._handshakeComplete)return console.warn(`[volumio-adapter] Cannot emit ${t} and wait for ${i}: not connected`),null;const a=i||t;return new Promise(i=>{let o=this._pendingResponses.get(a);o||(o=[],this._pendingResponses.set(a,o));const r={resolve:i,timer:null};o.push(r),r.timer=setTimeout(()=>{const e=this._pendingResponses.get(a);if(e){const t=e.indexOf(r);-1!==t&&e.splice(t,1),0===e.length&&this._pendingResponses.delete(a)}console.warn(`[volumio-adapter] Timeout waiting for ${t}`),i(null)},s);if(!this._sendRaw(`42${null!=e?JSON.stringify([t,e]):JSON.stringify([t])}`)){clearTimeout(r.timer);const t=this._pendingResponses.get(a);if(t){const e=t.indexOf(r);-1!==e&&t.splice(e,1),0===t.length&&this._pendingResponses.delete(a)}i(null)}})}_resolvePending(t,e){const i=this._pendingResponses.get(t);if(!i||0===i.length)return;const s=i.shift();s&&(s.timer&&clearTimeout(s.timer),s.resolve(e)),0===i.length&&this._pendingResponses.delete(t)}_startPingLoop(){this._stopPingLoop();const t=Math.max(this._pingIntervalMs-2e3,1e3);this._pingTimer=setInterval(()=>{if(!this._ws||this._ws.readyState!==WebSocket.OPEN)return void this._stopPingLoop();this._sendRaw("2")?(this._pongTimer&&clearTimeout(this._pongTimer),this._pongTimer=setTimeout(()=>{console.warn(`[volumio-adapter] PONG timeout (${this._pingTimeoutMs}ms) — connection lost`),this._handleConnectionLost()},this._pingTimeoutMs)):this._stopPingLoop()},t)}_stopPingLoop(){this._pingTimer&&(clearInterval(this._pingTimer),this._pingTimer=null),this._pongTimer&&(clearTimeout(this._pongTimer),this._pongTimer=null)}_handleConnectionLost(){if(this._shuttingDown)return;const t=this._handshakeComplete;if(this._handshakeComplete=!1,this._stopPingLoop(),this._failPendingConnect(new Error("connection lost")),this._ws){try{this._ws.close()}catch{}this._ws=null}if(t){const t=Mt(null,this._baseUrl);this._lastState=t,this._fireState(t)}this._scheduleReconnect()}_scheduleReconnect(){if(this._shuttingDown)return;if(this._reconnectTimer)return;const t=Math.min(5e3*Math.pow(2,this._reconnectAttempts),6e4);this._reconnectAttempts+=1,console.info(`[volumio-adapter] Reconnecting in ${t}ms (attempt ${this._reconnectAttempts})`),this._reconnectTimer=setTimeout(()=>{this._reconnectTimer=null,this._shuttingDown||this._open().catch(()=>{})},t)}_clearTimers(){this._stopPingLoop(),this._connectTimer&&(clearTimeout(this._connectTimer),this._connectTimer=null),this._reconnectTimer&&(clearTimeout(this._reconnectTimer),this._reconnectTimer=null)}_failPendingConnect(t){if(this._connectReject){const e=this._connectReject;this._connectResolve=null,this._connectReject=null,e(t)}this._connectTimer&&(clearTimeout(this._connectTimer),this._connectTimer=null)}_fireState(t){for(const e of this._stateListeners)try{e(t)}catch(t){console.error("[volumio-adapter] State listener error:",t)}}_notifyQueue(t){for(const e of this._queueListeners)try{e(t)}catch(t){console.error("[volumio-adapter] Queue listener error:",t)}}}const qt={"mdi:account-music":"M11,14C12,14 13.05,14.16 14.2,14.44C13.39,15.31 13,16.33 13,17.5C13,18.39 13.25,19.23 13.78,20H3V18C3,16.81 3.91,15.85 5.74,15.12C7.57,14.38 9.33,14 11,14M11,12C9.92,12 9,11.61 8.18,10.83C7.38,10.05 7,9.11 7,8C7,6.92 7.38,6 8.18,5.18C9,4.38 9.92,4 11,4C12.11,4 13.05,4.38 13.83,5.18C14.61,6 15,6.92 15,8C15,9.11 14.61,10.05 13.83,10.83C13.05,11.61 12.11,12 11,12M18.5,10H20L22,10V12H20V17.5A2.5,2.5 0 0,1 17.5,20A2.5,2.5 0 0,1 15,17.5A2.5,2.5 0 0,1 17.5,15C17.86,15 18.19,15.07 18.5,15.21V10Z","mdi:album":"M12,11A1,1 0 0,0 11,12A1,1 0 0,0 12,13A1,1 0 0,0 13,12A1,1 0 0,0 12,11M12,16.5C9.5,16.5 7.5,14.5 7.5,12C7.5,9.5 9.5,7.5 12,7.5C14.5,7.5 16.5,9.5 16.5,12C16.5,14.5 14.5,16.5 12,16.5M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z","mdi:arrow-left":"M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z","mdi:check":"M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z","mdi:chevron-down":"M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z","mdi:chevron-right":"M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z","mdi:close":"M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z","mdi:cog":"M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z","mdi:content-save-outline":"M17 3H5C3.89 3 3 3.9 3 5V19C3 20.1 3.89 21 5 21H19C20.1 21 21 20.1 21 19V7L17 3M19 19H5V5H16.17L19 7.83V19M12 12C10.34 12 9 13.34 9 15S10.34 18 12 18 15 16.66 15 15 13.66 12 12 12M6 6H15V10H6V6Z","mdi:delete-outline":"M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19M8,9H16V19H8V9M15.5,4L14.5,3H9.5L8.5,4H5V6H19V4H15.5Z","mdi:dots-horizontal":"M16,12A2,2 0 0,1 18,10A2,2 0 0,1 20,12A2,2 0 0,1 18,14A2,2 0 0,1 16,12M10,12A2,2 0 0,1 12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12M4,12A2,2 0 0,1 6,10A2,2 0 0,1 8,12A2,2 0 0,1 6,14A2,2 0 0,1 4,12Z","mdi:dots-vertical":"M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z","mdi:drag-horizontal-variant":"M21 11H3V9H21V11M21 13H3V15H21V13Z","mdi:equalizer":"M10,20H14V4H10V20M4,20H8V12H4V20M16,9V20H20V9H16Z","mdi:folder-music":"M22 8V11H16.5V16.11C14.66 16.53 13.26 18.09 13.04 20H4C2.9 20 2 19.11 2 18V6C2 4.89 2.89 4 4 4H10L12 6H20C21.1 6 22 6.89 22 8M18.5 13V18.21C18.19 18.07 17.86 18 17.5 18C16.12 18 15 19.12 15 20.5S16.12 23 17.5 23 20 21.88 20 20.5V15H22V13H18.5Z","mdi:folder-open-outline":"M6.1,10L4,18V8H21A2,2 0 0,0 19,6H12L10,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H19C19.9,20 20.7,19.4 20.9,18.5L23.2,10H6.1M19,18H6L7.6,12H20.6L19,18Z","mdi:heart":"M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z","mdi:heart-off":"M1,4.27L2.28,3L20,20.72L18.73,22L15.18,18.44L13.45,20.03L12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,7.55 2.23,6.67 2.63,5.9L1,4.27M7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,11.07 20.42,13.32 17.79,15.97L5.27,3.45C5.95,3.16 6.7,3 7.5,3Z","mdi:heart-outline":"M12.1,18.55L12,18.65L11.89,18.55C7.14,14.24 4,11.39 4,8.5C4,6.5 5.5,5 7.5,5C9.04,5 10.54,6 11.07,7.36H12.93C13.46,6 14.96,5 16.5,5C18.5,5 20,6.5 20,8.5C20,11.39 16.86,14.24 12.1,18.55M16.5,3C14.76,3 13.09,3.81 12,5.08C10.91,3.81 9.24,3 7.5,3C4.42,3 2,5.41 2,8.5C2,12.27 5.4,15.36 10.55,20.03L12,21.35L13.45,20.03C18.6,15.36 22,12.27 22,8.5C22,5.41 19.58,3 16.5,3Z","mdi:help-circle":"M15.07,11.25L14.17,12.17C13.45,12.89 13,13.5 13,15H11V14.5C11,13.39 11.45,12.39 12.17,11.67L13.41,10.41C13.78,10.05 14,9.55 14,9C14,7.89 13.1,7 12,7A2,2 0 0,0 10,9H8A4,4 0 0,1 12,5A4,4 0 0,1 16,9C16,9.88 15.64,10.67 15.07,11.25M13,19H11V17H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12C22,6.47 17.5,2 12,2Z","mdi:history":"M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3","mdi:magnify":"M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z","mdi:magnify-close":"M9,2A7,7 0 0,1 16,9C16,10.5 15.5,12 14.61,13.19L15.41,14H16L22,20L20,22L14,16V15.41L13.19,14.61C12,15.5 10.5,16 9,16A7,7 0 0,1 2,9A7,7 0 0,1 9,2M11.12,5.46L9,7.59L6.88,5.46L5.46,6.88L7.59,9L5.46,11.12L6.88,12.54L9,10.41L11.12,12.54L12.54,11.12L10.41,9L12.54,6.88L11.12,5.46Z","mdi:menu":"M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z","mdi:music-box":"M16,9H13V14.5A2.5,2.5 0 0,1 10.5,17A2.5,2.5 0 0,1 8,14.5A2.5,2.5 0 0,1 10.5,12C11.07,12 11.58,12.19 12,12.5V7H16M19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3Z","mdi:music-box-multiple-outline":"M20,2H8A2,2 0 0,0 6,4V16A2,2 0 0,0 8,18H20A2,2 0 0,0 22,16V4A2,2 0 0,0 20,2M20,16H8V4H20M12.5,15A2.5,2.5 0 0,0 15,12.5V7H18V5H14V10.5C13.58,10.19 13.07,10 12.5,10A2.5,2.5 0 0,0 10,12.5A2.5,2.5 0 0,0 12.5,15M4,6H2V20A2,2 0 0,0 4,22H18V20H4","mdi:music-note":"M12 3V13.55C11.41 13.21 10.73 13 10 13C7.79 13 6 14.79 6 17S7.79 21 10 21 14 19.21 14 17V7H18V3H12Z","mdi:music-note-off":"M4.27 3L3 4.27L12 13.27V13.55C11.41 13.21 10.73 13 10 13C7.79 13 6 14.79 6 17S7.79 21 10 21 14 19.21 14 17V15.27L19.73 21L21 19.73L4.27 3M14 7H18V3H12V8.18L14 10.18Z","mdi:open-in-new":"M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z","mdi:pause":"M14,19H18V5H14M6,19H10V5H6V19Z","mdi:pin":"M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z","mdi:pin-off":"M2,5.27L3.28,4L20,20.72L18.73,22L12.8,16.07V22H11.2V16H6V14L8,12V11.27L2,5.27M16,12L18,14V16H17.82L8,6.18V4H7V2H17V4H16V12Z","mdi:play":"M8,5.14V19.14L19,12.14L8,5.14Z","mdi:playlist-music":"M15,6H3V8H15V6M15,10H3V12H15V10M3,16H11V14H3V16M17,6V14.18C16.69,14.07 16.35,14 16,14A3,3 0 0,0 13,17A3,3 0 0,0 16,20A3,3 0 0,0 19,17V8H22V6H17Z","mdi:playlist-music-outline":"M15,6V8H3V6H15M15,10V12H3V10H15M3,16V14H11V16H3M17,6H22V8H19V17A3,3 0 0,1 16,20A3,3 0 0,1 13,17A3,3 0 0,1 16,14C16.35,14 16.69,14.07 17,14.18V6M16,16A1,1 0 0,0 15,17A1,1 0 0,0 16,18A1,1 0 0,0 17,17A1,1 0 0,0 16,16Z","mdi:playlist-plus":"M3 16H10V14H3M18 14V10H16V14H12V16H16V20H18V16H22V14M14 6H3V8H14M14 10H3V12H14V10Z","mdi:plus":"M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z","mdi:podcast":"M17,18.25V21.5H7V18.25C7,16.87 9.24,15.75 12,15.75C14.76,15.75 17,16.87 17,18.25M12,5.5A6.5,6.5 0 0,1 18.5,12C18.5,13.25 18.15,14.42 17.54,15.41L16,14.04C16.32,13.43 16.5,12.73 16.5,12C16.5,9.5 14.5,7.5 12,7.5C9.5,7.5 7.5,9.5 7.5,12C7.5,12.73 7.68,13.43 8,14.04L6.46,15.41C5.85,14.42 5.5,13.25 5.5,12A6.5,6.5 0 0,1 12,5.5M12,1.5A10.5,10.5 0 0,1 22.5,12C22.5,14.28 21.77,16.39 20.54,18.11L19.04,16.76C19.96,15.4 20.5,13.76 20.5,12A8.5,8.5 0 0,0 12,3.5A8.5,8.5 0 0,0 3.5,12C3.5,13.76 4.04,15.4 4.96,16.76L3.46,18.11C2.23,16.39 1.5,14.28 1.5,12A10.5,10.5 0 0,1 12,1.5M12,9.5A2.5,2.5 0 0,1 14.5,12A2.5,2.5 0 0,1 12,14.5A2.5,2.5 0 0,1 9.5,12A2.5,2.5 0 0,1 12,9.5Z","mdi:radio":"M20,6A2,2 0 0,1 22,8V20A2,2 0 0,1 20,22H4A2,2 0 0,1 2,20V8C2,7.15 2.53,6.42 3.28,6.13L15.71,1L16.47,2.83L8.83,6H20M20,8H4V12H16V10H18V12H20V8M7,14A3,3 0 0,0 4,17A3,3 0 0,0 7,20A3,3 0 0,0 10,17A3,3 0 0,0 7,14Z","mdi:repeat":"M17,17H7V14L3,18L7,22V19H19V13H17M7,7H17V10L21,6L17,2V5H5V11H7V7Z","mdi:repeat-once":"M13,15V9H12L10,10V11H11.5V15M17,17H7V14L3,18L7,22V19H19V13H17M7,7H17V10L21,6L17,2V5H5V11H7V7Z","mdi:shuffle-variant":"M17,3L22.25,7.5L17,12L22.25,16.5L17,21V18H14.26L11.44,15.18L13.56,13.06L15.5,15H17V12L17,9H15.5L6.5,18H2V15H5.26L14.26,6H17V3M2,6H6.5L9.32,8.82L7.2,10.94L5.26,9H2V6Z","mdi:skip-next":"M16,18H18V6H16M6,18L14.5,12L6,6V18Z","mdi:skip-previous":"M6,18V6H8V18H6M9.5,12L18,6V18L9.5,12Z","mdi:speaker-multiple":"M14,10A3,3 0 0,0 11,13A3,3 0 0,0 14,16A3,3 0 0,0 17,13A3,3 0 0,0 14,10M14,18A5,5 0 0,1 9,13A5,5 0 0,1 14,8A5,5 0 0,1 19,13A5,5 0 0,1 14,18M14,2A2,2 0 0,1 16,4A2,2 0 0,1 14,6A2,2 0 0,1 12,4A2,2 0 0,1 14,2M19,0H9A2,2 0 0,0 7,2V18A2,2 0 0,0 9,20H19A2,2 0 0,0 21,18V2A2,2 0 0,0 19,0M5,22H17V24H5A2,2 0 0,1 3,22V4H5","mdi:spotify":"M17.9,10.9C14.7,9 9.35,8.8 6.3,9.75C5.8,9.9 5.3,9.6 5.15,9.15C5,8.65 5.3,8.15 5.75,8C9.3,6.95 15.15,7.15 18.85,9.35C19.3,9.6 19.45,10.2 19.2,10.65C18.95,11 18.35,11.15 17.9,10.9M17.8,13.7C17.55,14.05 17.1,14.2 16.75,13.95C14.05,12.3 9.95,11.8 6.8,12.8C6.4,12.9 5.95,12.7 5.85,12.3C5.75,11.9 5.95,11.45 6.35,11.35C10,10.25 14.5,10.8 17.6,12.7C17.9,12.85 18.05,13.35 17.8,13.7M16.6,16.45C16.4,16.75 16.05,16.85 15.75,16.65C13.4,15.2 10.45,14.9 6.95,15.7C6.6,15.8 6.3,15.55 6.2,15.25C6.1,14.9 6.35,14.6 6.65,14.5C10.45,13.65 13.75,14 16.35,15.6C16.7,15.75 16.75,16.15 16.6,16.45M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z","mdi:view-grid":"M3,11H11V3H3M3,21H11V13H3M13,21H21V13H13M13,3V11H21V3","mdi:view-list":"M9,5V9H21V5M9,19H21V15H9M9,14H21V10H9M4,9H8V5H4M4,19H8V15H4M4,14H8V10H4V14Z","mdi:volume-high":"M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z","mdi:volume-mute":"M3,9H7L12,4V20L7,15H3V9M16.59,12L14,9.41L15.41,8L18,10.59L20.59,8L22,9.41L19.41,12L22,14.59L20.59,16L18,13.41L15.41,16L14,14.59L16.59,12Z","mdi:youtube":"M10,15L15.19,12L10,9V15M21.56,7.17C21.69,7.64 21.78,8.27 21.84,9.07C21.91,9.87 21.94,10.56 21.94,11.16L22,12C22,14.19 21.84,15.8 21.56,16.83C21.31,17.73 20.73,18.31 19.83,18.56C19.36,18.69 18.5,18.78 17.18,18.84C15.88,18.91 14.69,18.94 13.59,18.94L12,19C7.81,19 5.2,18.84 4.17,18.56C3.27,18.31 2.69,17.73 2.44,16.83C2.31,16.36 2.22,15.73 2.16,14.93C2.09,14.13 2.06,13.44 2.06,12.84L2,12C2,9.81 2.16,8.2 2.44,7.17C2.69,6.27 3.27,5.69 4.17,5.44C4.64,5.31 5.5,5.22 6.82,5.16C8.12,5.09 9.31,5.06 10.41,5.06L12,5C16.19,5 18.8,5.16 19.83,5.44C20.73,5.69 21.31,6.27 21.56,7.17Z"};class Tt extends rt{static get properties(){return{icon:{type:String}}}static get styles(){return o`
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--mdc-icon-size, 24px);
        height: var(--mdc-icon-size, 24px);
        vertical-align: middle;
        line-height: 0;
      }

      svg {
        width: 100%;
        height: 100%;
        fill: currentColor;
      }
    `}render(){const t=qt[this.icon];return t?N`
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="${t}"></path>
      </svg>
    `:(this.icon&&!Tt._warned.has(this.icon)&&(Tt._warned.add(this.icon),console.warn(`[litgui-icon] No bundled path for "${this.icon}"`)),N`<svg viewBox="0 0 24 24" aria-hidden="true"></svg>`)}}Tt._warned=new Set,customElements.define("litgui-icon",Tt);const Pt=[{key:"now-playing",label:"Now Playing"},{key:"browse",label:"Browse"},{key:"playlists",label:"Playlists"},{key:"favorites",label:"Favorites"}];customElements.define("volumio-top-bar",class extends rt{static get properties(){return{activeView:{type:String,attribute:"active-view"},breadcrumb:{type:Array},showBackButton:{type:Boolean,attribute:"show-back-button"},narrow:{type:Boolean},mobile:{type:Boolean},searchQuery:{type:String,attribute:"search-query"},devices:{type:Array},activeDeviceId:{type:String,attribute:"active-device-id"},_searchValue:{type:String,state:!0},_searchFocused:{type:Boolean,state:!0},_deviceMenuOpen:{type:Boolean,state:!0},_mobileSearchOpen:{type:Boolean,state:!0}}}static get styles(){return o`
      :host {
        display: block;
        position: relative;
        z-index: 100;
      }

      .topbar {
        display: flex;
        align-items: center;
        height: var(--volumio-topbar-height, 48px);
        padding: 0 var(--volumio-space-sm, 8px);
        background: var(--card-background-color, #1e1e1e);
        border-bottom: 1px solid var(--divider-color, rgba(255,255,255,0.12));
        gap: var(--volumio-space-xs, 4px);
      }

      .icon-btn {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        border: none;
        background: transparent;
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        padding: 0;
      }

      .icon-btn:hover {
        background: var(--divider-color, rgba(255,255,255,0.08));
      }

      litgui-icon {
        --mdc-icon-size: 24px;
      }

      .tabs {
        display: flex;
        gap: 2px;
        flex-shrink: 0;
      }

      .tab {
        padding: 6px 14px;
        border-radius: 6px;
        border: none;
        background: transparent;
        color: var(--secondary-text-color, #aaa);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
        white-space: nowrap;
      }

      .tab:hover {
        background: var(--divider-color, rgba(255,255,255,0.08));
        color: var(--primary-text-color);
      }

      .tab.active {
        background: var(--primary-color, #03a9f4);
        color: #fff;
      }

      .spacer {
        flex: 1;
      }

      .search-field {
        display: flex;
        align-items: center;
        background: var(--primary-background-color, #121212);
        border: 1px solid var(--divider-color, rgba(255,255,255,0.12));
        border-radius: 20px;
        padding: 0 12px;
        height: 34px;
        min-width: 180px;
        max-width: 300px;
        flex-shrink: 1;
        gap: 6px;
        cursor: text;
      }

      .search-field litgui-icon {
        --mdc-icon-size: 18px;
        color: var(--secondary-text-color);
        flex-shrink: 0;
      }

      .search-field input {
        flex: 1;
        border: none;
        background: transparent;
        color: var(--primary-text-color);
        font-size: 13px;
        outline: none;
        min-width: 0;
      }

      .search-field input::placeholder {
        color: var(--secondary-text-color, #888);
      }

      .search-field input:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .search-clear {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: none;
        background: var(--secondary-text-color, #888);
        color: var(--primary-background-color, #121212);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        flex-shrink: 0;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
      }

      .search-clear:hover {
        background: var(--primary-text-color);
      }

      .recent-searches {
        position: absolute;
        top: 100%;
        right: 0;
        left: 0;
        margin: 0 var(--volumio-space-sm, 8px);
        background: var(--card-background-color, #1e1e1e);
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        padding: var(--volumio-space-sm, 8px);
        z-index: 110;
        max-width: 320px;
        margin-left: auto;
      }

      .recent-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--secondary-text-color);
        padding: 4px 8px;
      }

      .recent-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 4px;
      }

      .recent-chip {
        padding: 4px 12px;
        border-radius: 14px;
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        background: transparent;
        color: var(--primary-text-color);
        font-size: 13px;
        cursor: pointer;
        transition: background 0.15s;
      }

      .recent-chip:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }

      .breadcrumb-row {
        display: flex;
        align-items: center;
        height: var(--volumio-breadcrumb-height, 32px);
        padding: 0 var(--volumio-space-md, 16px);
        background: var(--card-background-color, #1e1e1e);
        border-bottom: 1px solid var(--divider-color, rgba(255,255,255,0.06));
        font-size: 13px;
        color: var(--secondary-text-color);
        gap: 4px;
        overflow: hidden;
      }

      .device-selector {
        position: relative;
        flex-shrink: 0;
      }

      .device-menu {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        min-width: 200px;
        background: var(--card-background-color, #1e1e1e);
        border: 1px solid var(--divider-color, rgba(255,255,255,0.12));
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        padding: 4px;
        z-index: 110;
      }

      .device-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border: none;
        background: transparent;
        color: var(--primary-text-color);
        width: 100%;
        text-align: left;
        font-size: 13px;
        cursor: pointer;
        border-radius: 6px;
      }

      .device-menu-item:hover {
        background: var(--divider-color, rgba(255,255,255,0.08));
      }

      .device-menu-item.active {
        font-weight: 600;
      }

      .device-menu-item litgui-icon {
        --mdc-icon-size: 18px;
        color: var(--primary-color, #03a9f4);
        flex-shrink: 0;
      }

      .device-menu-item .device-menu-spacer {
        width: 18px;
        flex-shrink: 0;
      }

      .device-menu-item .device-menu-name {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .breadcrumb-segment {
        cursor: pointer;
        color: var(--secondary-text-color);
        text-decoration: none;
        white-space: nowrap;
      }

      .breadcrumb-segment:hover {
        color: var(--primary-text-color);
        text-decoration: underline;
      }

      .breadcrumb-segment.current {
        color: var(--primary-text-color);
        font-weight: 600;
        cursor: default;
      }

      .breadcrumb-segment.current:hover {
        text-decoration: none;
      }

      .breadcrumb-sep {
        color: var(--secondary-text-color);
        opacity: 0.5;
        flex-shrink: 0;
      }

      @media (max-width: 768px) {
        .search-field {
          min-width: 120px;
        }
        .tab {
          padding: 6px 10px;
          font-size: 13px;
        }
      }

      /* ── Mobile top-bar (T48 Phase 1b) ─────────── */
      .topbar.mobile {
        display: flex;
        align-items: center;
        height: var(--volumio-topbar-height, 48px);
        padding: 0 var(--volumio-space-sm, 8px);
        background: var(--card-background-color, #1e1e1e);
        border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        gap: var(--volumio-space-xs, 4px);
      }

      .topbar.mobile .icon-btn {
        width: 44px;
        height: 44px;
      }

      .mobile-quick-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        padding: 0 12px;
        border: none;
        background: transparent;
        color: var(--primary-text-color);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        border-radius: 8px;
        white-space: nowrap;
      }
      .mobile-quick-btn:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }
      .mobile-quick-btn.active {
        color: var(--primary-color, #03a9f4);
      }
      .mobile-quick-btn litgui-icon {
        --mdc-icon-size: 22px;
      }

      .mobile-search-row {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px 12px;
        background: var(--card-background-color, #1e1e1e);
        border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
      }

      .mobile-search-row .search-field {
        height: 44px;
        min-width: 0;
        max-width: none;
        flex: 1;
        border-radius: 22px;
        padding: 0 14px;
      }

      .mobile-search-row .search-field input {
        font-size: 16px; /* prevent iOS zoom-on-focus */
      }

      .mobile-search-row .search-clear {
        width: 32px;
        height: 32px;
        font-size: 14px;
      }

      .mobile-recent {
        padding: 4px 0;
      }

      .mobile-recent .recent-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--secondary-text-color);
        padding: 4px 4px;
      }

      .mobile-recent .recent-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 4px 0;
      }

      .mobile-recent .recent-chip {
        min-height: 44px;
        padding: 8px 16px;
        border-radius: 22px;
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        background: transparent;
        color: var(--primary-text-color);
        font-size: 14px;
        cursor: pointer;
      }
      .mobile-recent .recent-chip:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }
    `}constructor(){super(),this.activeView="now-playing",this.breadcrumb=[],this.showBackButton=!1,this.narrow=!1,this.mobile=!1,this.searchQuery="",this.devices=[],this.activeDeviceId="",this._searchValue="",this._searchFocused=!1,this._deviceMenuOpen=!1,this._mobileSearchOpen=!1,this._debounceTimer=null;let t=[];try{t=JSON.parse(wt("volumio-recent-searches","[]")),Array.isArray(t)||(t=[])}catch{t=[]}this._recentSearches=t,this._onDocClick=this._onDocClick.bind(this)}connectedCallback(){super.connectedCallback(),document.addEventListener("click",this._onDocClick)}disconnectedCallback(){super.disconnectedCallback(),document.removeEventListener("click",this._onDocClick)}_onDocClick(t){if(!this._deviceMenuOpen)return;(t.composedPath?t.composedPath():[]).includes(this)||(this._deviceMenuOpen=!1)}render(){return this.mobile?this._renderMobile():N`
      <div class="topbar">
        <button
          class="icon-btn"
          @click=${this._toggleNav}
          title="Toggle navigation"
          aria-label="Toggle navigation sidebar"
        >
          <litgui-icon icon="mdi:menu"></litgui-icon>
        </button>

        ${this.showBackButton?N`
          <button
            class="icon-btn"
            @click=${this._goBack}
            title="Back"
            aria-label="Go back"
          >
            <litgui-icon icon="mdi:arrow-left"></litgui-icon>
          </button>
        `:""}

        <div class="tabs">
          ${Pt.map(t=>N`
            <button
              class="tab ${this.activeView===t.key?"active":""}"
              @click=${()=>this._navigate(t.key)}
            >
              ${t.label}
            </button>
          `)}
        </div>

        <div class="spacer"></div>

        <div class="search-field" @click=${this._focusSearch} title="Search music">
          <litgui-icon icon="mdi:magnify"></litgui-icon>
          <input
            type="text"
            placeholder="Search..."
            aria-label="Search music"
            .value=${this._searchValue}
            @input=${this._onSearchInput}
            @focus=${this._onSearchFieldFocus}
            @blur=${this._onSearchFieldBlur}
            @keydown=${this._onSearchKeydown}
          />
          ${this._searchValue?N`
            <button class="search-clear" @click=${this._clearSearch} title="Clear search" aria-label="Clear search">✕</button>
          `:""}
        </div>

        ${this._searchFocused&&!this._searchValue&&this._recentSearches.length>0?N`
          <div class="recent-searches">
            <div class="recent-label">Recent</div>
            <div class="recent-chips">
              ${this._recentSearches.slice(0,10).map(t=>N`
                <button class="recent-chip" @mousedown=${e=>{e.preventDefault(),this._useRecentSearch(t)}}>${t}</button>
              `)}
            </div>
          </div>
        `:""}

        <button
          class="icon-btn"
          @click=${this._toggleQueue}
          title="Toggle queue"
          aria-label="Toggle queue panel"
        >
          <litgui-icon icon="mdi:playlist-music"></litgui-icon>
        </button>

        ${this._renderDeviceSelector()}
      </div>

      ${this.breadcrumb.length>0?this._renderBreadcrumb():""}
    `}_renderMobile(){return N`
      <div class="topbar mobile">
        <button
          class="icon-btn"
          @click=${this._toggleNav}
          title="Toggle navigation"
          aria-label="Toggle navigation sidebar"
        >
          <litgui-icon icon="mdi:menu"></litgui-icon>
        </button>

        <button
          class="mobile-quick-btn ${"now-playing"===this.activeView?"active":""}"
          @click=${()=>this._navigate("now-playing")}
          title="Now Playing"
          aria-label="Now Playing"
        >
          <litgui-icon icon="mdi:music-note"></litgui-icon>
          <span>Now Playing</span>
        </button>

        <div class="spacer"></div>

        <button
          class="icon-btn"
          @click=${this._toggleMobileSearch}
          title="Search"
          aria-label="Toggle search"
          aria-expanded=${this._mobileSearchOpen?"true":"false"}
        >
          <litgui-icon icon="mdi:magnify"></litgui-icon>
        </button>

        <button
          class="icon-btn"
          @click=${this._toggleQueue}
          title="Toggle queue"
          aria-label="Toggle queue panel"
        >
          <litgui-icon icon="mdi:playlist-music"></litgui-icon>
        </button>
      </div>

      ${this._mobileSearchOpen?N`
        <div class="mobile-search-row">
          <div class="search-field" @click=${this._focusSearch}>
            <litgui-icon icon="mdi:magnify"></litgui-icon>
            <input
              type="text"
              placeholder="Search..."
              aria-label="Search music"
              .value=${this._searchValue}
              @input=${this._onSearchInput}
              @focus=${this._onSearchFieldFocus}
              @blur=${this._onSearchFieldBlur}
              @keydown=${this._onSearchKeydown}
            />
            <button
              class="search-clear"
              @click=${()=>{this._clearSearch(),this._mobileSearchOpen=!1}}
              title="Close search"
              aria-label="Close search"
            >✕</button>
          </div>
          ${!this._searchValue&&this._recentSearches.length>0?N`
            <div class="mobile-recent">
              <div class="recent-label">Recent</div>
              <div class="recent-chips">
                ${this._recentSearches.slice(0,10).map(t=>N`
                  <button
                    class="recent-chip"
                    @mousedown=${e=>{e.preventDefault(),this._useRecentSearch(t),this._mobileSearchOpen=!1}}
                  >${t}</button>
                `)}
              </div>
            </div>
          `:""}
        </div>
      `:""}
    `}_toggleMobileSearch(){const t=!this._mobileSearchOpen;this._mobileSearchOpen=t,t&&this.updateComplete.then(()=>{const t=this.shadowRoot?.querySelector(".mobile-search-row .search-field input");t&&t.focus()})}_renderDeviceSelector(){const t=Array.isArray(this.devices)?this.devices:[];if(t.length<=1)return"";const e=t.find(t=>t.config_entry_id===this.activeDeviceId)||t[0],i=e?.name||"Device";return N`
      <div class="device-selector">
        <button
          class="icon-btn"
          @click=${this._toggleDeviceMenu}
          title="Device: ${i} — switch"
          aria-label="Switch Volumio device (current: ${i})"
          aria-haspopup="listbox"
          aria-expanded=${this._deviceMenuOpen?"true":"false"}
        >
          <litgui-icon icon="mdi:speaker-multiple"></litgui-icon>
        </button>
        ${this._deviceMenuOpen?N`
          <div class="device-menu" role="listbox">
            ${t.map(t=>{const e=t.config_entry_id===this.activeDeviceId;return N`
                <button
                  class="device-menu-item ${e?"active":""}"
                  role="option"
                  aria-selected=${e?"true":"false"}
                  @click=${()=>this._selectDevice(t.config_entry_id)}
                >
                  ${e?N`<litgui-icon icon="mdi:check"></litgui-icon>`:N`<span class="device-menu-spacer"></span>`}
                  <span class="device-menu-name">${t.name||t.config_entry_id}</span>
                </button>
              `})}
          </div>
        `:""}
      </div>
    `}_toggleDeviceMenu(t){t.stopPropagation(),this._deviceMenuOpen=!this._deviceMenuOpen}_selectDevice(t){this._deviceMenuOpen=!1,t!==this.activeDeviceId&&this.dispatchEvent(new CustomEvent("volumio-device-change",{detail:{config_entry_id:t},bubbles:!0,composed:!0}))}_renderBreadcrumb(){const t=this.breadcrumb,e=t.length>5?[t[0],{label:"...",path:null},...t.slice(-3)]:t;return N`
      <div class="breadcrumb-row">
        ${e.map((t,i)=>{const s=i===e.length-1;return N`
            ${i>0?N`<span class="breadcrumb-sep"><litgui-icon icon="mdi:chevron-right" style="--mdc-icon-size:14px"></litgui-icon></span>`:""}
            <span
              class="breadcrumb-segment ${s?"current":""}"
              @click=${()=>!s&&null!=t.path&&this._navigate(t.path)}
            >${t.label}</span>
          `})}
      </div>
    `}_navigate(t){this.dispatchEvent(new CustomEvent("volumio-navigate",{detail:{view:t},bubbles:!0,composed:!0}))}_toggleNav(){this.dispatchEvent(new CustomEvent("volumio-toggle-nav",{bubbles:!0,composed:!0}))}_toggleQueue(){this.dispatchEvent(new CustomEvent("volumio-toggle-queue",{bubbles:!0,composed:!0}))}_goBack(){this.dispatchEvent(new CustomEvent("volumio-back",{bubbles:!0,composed:!0}))}_focusSearch(){const t=this.shadowRoot.querySelector(".search-field input");t&&t.focus()}_onSearchFieldFocus(){this._searchFocused=!0}_onSearchFieldBlur(){setTimeout(()=>{this._searchFocused=!1},200)}_onSearchInput(t){this._searchValue=t.target.value,clearTimeout(this._debounceTimer),this._searchValue.trim().length<2?0===this._searchValue.trim().length&&this.dispatchEvent(new CustomEvent("volumio-search-clear",{bubbles:!0,composed:!0})):this._debounceTimer=setTimeout(()=>{this._executeSearch(this._searchValue.trim())},300)}_onSearchKeydown(t){"Escape"===t.key?(this._clearSearch(),t.target.blur()):"Enter"===t.key&&(clearTimeout(this._debounceTimer),this._searchValue.trim().length>=2&&this._executeSearch(this._searchValue.trim()))}_executeSearch(t){this._recentSearches=[t,...this._recentSearches.filter(e=>e!==t)].slice(0,10),kt("volumio-recent-searches",JSON.stringify(this._recentSearches)),this.dispatchEvent(new CustomEvent("volumio-search",{detail:{query:t},bubbles:!0,composed:!0}))}_clearSearch(){this._searchValue="",clearTimeout(this._debounceTimer),this.dispatchEvent(new CustomEvent("volumio-search-clear",{bubbles:!0,composed:!0}))}_useRecentSearch(t){this._searchValue=t,this._searchFocused=!1,this._executeSearch(t)}_onSearchFocus(){this.dispatchEvent(new CustomEvent("volumio-search-focus",{bubbles:!0,composed:!0}))}});const It=2;class Ht{constructor(t){}get _$AU(){return this._$AM._$AU}_$AT(t,e,i){this._$Ct=t,this._$AM=e,this._$Ci=i}_$AS(t,e){return this.update(t,e)}update(t,e){return this.render(...e)}}class zt extends Ht{constructor(t){if(super(t),this.it=O,t.type!==It)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(t){if(t===O||null==t)return this._t=void 0,this.it=t;if(t===R)return t;if("string"!=typeof t)throw Error(this.constructor.directiveName+"() called with a non-string value");if(t===this.it)return this._t;this.it=t;const e=[t];return e.raw=e,this._t={_$litType$:this.constructor.resultType,strings:e,values:[]}}}zt.directiveName="unsafeHTML",zt.resultType=1;const Ut=(t=>(...e)=>({_$litDirective$:t,values:e}))(zt),Dt=[{key:"favorites",label:"Favorites",icon:"mdi:heart"},{key:"playlists",label:"Playlists",icon:"mdi:playlist-music-outline"},{key:"history",label:"History",icon:"mdi:history"}],Qt={music_service:"mdi:music-box",mpd:"mdi:folder-music",webradio:"mdi:radio",podcast:"mdi:podcast"};customElements.define("volumio-left-nav",class extends rt{static get properties(){return{sources:{type:Array},activeSource:{type:String,attribute:"active-source"},mode:{type:String},activeView:{type:String,attribute:"active-view"},standalone:{type:Boolean}}}static get styles(){return o`
      :host {
        display: block;
        height: 100%;
      }

      /* ── Pinned nav ──────────────────────────────── */
      .nav {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--card-background-color, #1e1e1e);
        border-right: 1px solid var(--divider-color, rgba(255,255,255,0.08));
        overflow: hidden;
      }

      .nav.pinned {
        width: var(--volumio-nav-width-pinned, 240px);
      }

      .nav.collapsed {
        width: var(--volumio-nav-width-collapsed, 56px);
      }

      .nav.flyout {
        width: var(--volumio-nav-width-pinned, 240px);
      }

      .nav-scroll {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: var(--volumio-space-sm, 8px) 0;
      }

      .nav-section-label {
        padding: var(--volumio-space-md, 16px) var(--volumio-space-md, 16px) var(--volumio-space-xs, 4px);
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--secondary-text-color, #888);
      }

      .nav-section-label.collapsed {
        display: none;
      }

      .nav-item {
        display: flex;
        align-items: center;
        height: 44px;
        padding: 0 var(--volumio-space-md, 16px);
        cursor: pointer;
        color: var(--primary-text-color);
        font-size: 14px;
        transition: background 0.15s;
        gap: 12px;
        text-decoration: none;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
        position: relative;
      }

      .nav-item:hover {
        background: var(--divider-color, rgba(255,255,255,0.08));
      }

      .nav-item.active {
        color: var(--primary-color, #03a9f4);
      }

      .nav-item.active::before {
        content: "";
        position: absolute;
        left: 0;
        top: 8px;
        bottom: 8px;
        width: 3px;
        background: var(--primary-color, #03a9f4);
        border-radius: 0 2px 2px 0;
      }

      .nav-item litgui-icon {
        --mdc-icon-size: 22px;
        flex-shrink: 0;
        width: 24px;
      }

      .nav-item-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .collapsed .nav-item {
        justify-content: center;
        padding: 0;
      }

      .collapsed .nav-item-label {
        display: none;
      }

      .collapsed .nav-item litgui-icon {
        margin: 0;
      }

      .nav-divider {
        height: 1px;
        background: var(--divider-color, rgba(255,255,255,0.08));
        margin: var(--volumio-space-sm, 8px) var(--volumio-space-md, 16px);
      }

      .nav-footer {
        border-top: 1px solid var(--divider-color, rgba(255,255,255,0.08));
        padding: var(--volumio-space-sm, 8px) 0;
      }

      .pin-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 36px;
        border: none;
        background: none;
        color: var(--secondary-text-color);
        cursor: pointer;
        font-size: 12px;
        gap: 6px;
      }

      .pin-btn:hover {
        color: var(--primary-text-color);
        background: var(--divider-color, rgba(255,255,255,0.08));
      }

      .pin-btn litgui-icon {
        --mdc-icon-size: 18px;
      }

      /* Collapsed: pin button icon only */
      .collapsed .pin-btn span {
        display: none;
      }

      /* ── Brand footer ──────────────── */
      .brand-link {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 6px 0 2px;
        opacity: 0.7;
        text-decoration: none;
      }

      .brand-link svg {
        width: 90px;
        height: auto;
        display: block;
      }

      .collapsed .brand-link {
        display: none;
      }
    `}constructor(){super(),this.sources=[],this.activeSource="",this.mode="pinned",this.activeView="",this.standalone=!1}render(){const t="collapsed"===this.mode;return N`
      <nav class="nav ${this.mode}" aria-label="Music sources">
        <div class="nav-scroll">
          <div class="nav-section-label ${t?"collapsed":""}">Sources</div>
          ${this.sources.map(t=>{const e=Qt[t.plugin_name]||Qt[t.plugin_type]||"mdi:music-box",i=this.activeSource===t.uri;return N`
              <button
                class="nav-item ${i?"active":""}"
                @click=${()=>this._selectSource(t)}
                title="${t.name}"
                aria-label="${t.name}"
              >
                <litgui-icon icon="${e}"></litgui-icon>
                <span class="nav-item-label">${t.name}</span>
              </button>
            `})}

          <div class="nav-divider"></div>
          <div class="nav-section-label ${t?"collapsed":""}">Shortcuts</div>

          ${Dt.map(t=>N`
            <button
              class="nav-item ${this.activeView===t.key?"active":""}"
              @click=${()=>this._navigate(t.key)}
              title="${t.label}"
              aria-label="${t.label}"
            >
              <litgui-icon icon="${t.icon}"></litgui-icon>
              <span class="nav-item-label">${t.label}</span>
            </button>
          `)}

          <div class="nav-divider"></div>

          <button
            class="nav-item"
            @click=${()=>this._navigate("settings")}
            title="Settings"
            aria-label="Panel Settings"
          >
            <litgui-icon icon="mdi:cog"></litgui-icon>
            <span class="nav-item-label">Settings</span>
          </button>
        </div>

        ${this.standalone?"":N`
          <div class="nav-footer">
            <button class="pin-btn" @click=${this._togglePin} title="${t?"Pin sidebar":"Collapse sidebar"}">
              <litgui-icon icon="${t?"mdi:pin":"mdi:pin-off"}"></litgui-icon>
              <span>${t?"Pin":"Collapse"}</span>
            </button>
            <a class="brand-link" href="https://litgui.com" target="_blank" rel="noopener noreferrer" aria-label="LitGUI — litgui.com">
              ${Ut('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 124 48" width="400" height="155">\n  <path d="M12 18 L5 28 L12 38" stroke="#1A1A1A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>\n  <path d="M28 38 L35 28 L28 18" stroke="#1A1A1A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>\n  <path d="M20 30 C20 30 15 20 15 16 C15 12 17 10 20 10 C23 10 25 12 25 16 C25 20 20 30 20 30Z" fill="#EF9F27" opacity="0.9"/>\n  <path d="M20 26 C20 26 17 20 17 18 C17 15 18 14 20 14 C22 14 23 15 23 18 C23 20 20 26 20 26Z" fill="#F5C475"/>\n  \x3c!-- LitGUI wordmark — DM Sans outlined --\x3e\n  <path fill="#1A1A1A" transform="translate(42.000 38.000) scale(0.028000 -0.028000)" d="M73 0V700H173V79H493V0Z"/>\n  <path fill="#1A1A1A" transform="translate(57.036 38.000) scale(0.028000 -0.028000)" d="M75 0V504H175V0ZM126 599Q97 599 78.5 617.0Q60 635 60 663Q60 690 78.5 707.5Q97 725 126 725Q154 725 173.0 707.5Q192 690 192 663Q192 635 173.0 617.0Q154 599 126 599Z"/>\n  <path fill="#1A1A1A" transform="translate(64.036 38.000) scale(0.028000 -0.028000)" d="M276 0Q228 0 193.0 15.0Q158 30 139.0 65.0Q120 100 120 160V419H33V504H120L132 630H220V504H363V419H220V159Q220 116 238.0 100.5Q256 85 300 85H358V0Z"/>\n  <path fill="#6B6560" transform="translate(75.376 38.000) scale(0.028000 -0.028000)" d="M376 -12Q278 -12 204.0 33.5Q130 79 89.5 160.5Q49 242 49 350Q49 457 90.5 538.5Q132 620 207.5 666.0Q283 712 386 712Q502 712 580.0 656.0Q658 600 680 500H598Q584 568 528.5 608.0Q473 648 386 648Q306 648 246.5 612.0Q187 576 154.0 509.5Q121 443 121 350Q121 257 153.5 190.0Q186 123 243.5 87.0Q301 51 376 51Q494 51 553.5 121.0Q613 191 621 314H410V371H693V0H629L623 124Q597 81 563.5 50.0Q530 19 484.5 3.5Q439 -12 376 -12Z"/>\n  <path fill="#6B6560" transform="translate(96.516 38.000) scale(0.028000 -0.028000)" d="M324 -12Q253 -12 195.5 16.0Q138 44 104.0 103.5Q70 163 70 255V700H140V254Q140 183 163.5 137.5Q187 92 229.0 71.0Q271 50 325 50Q380 50 421.0 71.0Q462 92 485.0 137.5Q508 183 508 254V700H578V255Q578 163 544.0 103.5Q510 44 452.5 16.0Q395 -12 324 -12Z"/>\n  <path fill="#6B6560" transform="translate(114.660 38.000) scale(0.028000 -0.028000)" d="M78 0V700H148V0Z"/>\n</svg>')}
            </a>
          </div>
        `}
      </nav>
    `}_selectSource(t){this.dispatchEvent(new CustomEvent("volumio-navigate",{detail:{view:"browse",source:t.name,sourceUri:t.uri,pluginName:t.plugin_name},bubbles:!0,composed:!0}))}_navigate(t){this.dispatchEvent(new CustomEvent("volumio-navigate",{detail:{view:t},bubbles:!0,composed:!0}))}_togglePin(){const t="collapsed"===this.mode;this.dispatchEvent(new CustomEvent("volumio-nav-pin",{detail:{pinned:t},bubbles:!0,composed:!0}))}});customElements.define("volumio-quality-badge",class extends rt{static get properties(){return{quality:{type:Object},size:{type:String}}}static get styles(){return o`
      :host {
        display: inline-block;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        line-height: 1;
        white-space: nowrap;
      }

      .badge.normal {
        font-size: 11px;
        height: 22px;
      }

      .badge.small {
        font-size: 10px;
        height: 18px;
        padding: 1px 6px;
      }

      .badge.large {
        font-size: 13px;
        height: 26px;
        padding: 3px 12px;
      }
    `}constructor(){super(),this.quality=null,this.size="normal"}render(){if(!this.quality||"unknown"===this.quality.tier||!this.quality.label)return N``;const t=this.quality,e="small"===this.size?"small":"large"===this.size?"large":"normal";return N`
      <span
        class="badge ${e}"
        style="color: ${t.color}; background: ${t.colorBg};"
        aria-label="Audio quality: ${t.label}"
        title="${t.tierLabel}: ${t.label}"
      >
        ${t.label}
      </span>
    `}});const Bt={qobuz:"Qobuz",tidal:"TIDAL",mpd:"Local",webradio:"Radio",spotify:"Spotify",spop:"Spotify",pandora:"Pandora",youtube:"YouTube",youtube2:"YouTube"},Nt={mpd:"mdi:folder-music",webradio:"mdi:radio"};customElements.define("volumio-source-badge",class extends rt{static get properties(){return{source:{type:String}}}static get styles(){return o`
      :host {
        display: inline-flex;
        align-items: center;
      }

      .source {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--secondary-text-color, #727272);
        white-space: nowrap;
      }

      litgui-icon {
        --mdc-icon-size: 14px;
        width: 14px;
        height: 14px;
      }
    `}constructor(){super(),this.source=""}render(){if(!this.source)return N``;const t=Bt[this.source]||this.source,e=Nt[this.source]||null;return N`
      <span class="source">
        ${e?N`<litgui-icon icon="${e}"></litgui-icon>`:""}
        ${t}
      </span>
    `}});customElements.define("volumio-player-bar",class extends rt{static get properties(){return{playerState:{type:String,attribute:"player-state"},title:{type:String},artist:{type:String},albumArt:{type:String,attribute:"album-art"},duration:{type:Number},position:{type:Number},positionUpdatedAt:{type:String,attribute:"position-updated-at"},volume:{type:Number},muted:{type:Boolean},shuffle:{type:Boolean},repeat:{type:String},quality:{type:Object},source:{type:String},volumeEnabled:{type:Boolean,attribute:"volume-enabled"},isFavorite:{type:Boolean,attribute:"is-favorite"},mini:{type:Boolean},_displayPosition:{type:Number,state:!0},_isDragging:{type:Boolean,state:!0},_miniVolOpen:{type:Boolean,state:!0},_miniMenuOpen:{type:Boolean,state:!0}}}static get styles(){return o`
      :host {
        display: block;
        position: relative;
        z-index: 100;
      }

      .player-bar {
        display: flex;
        align-items: center;
        height: var(--volumio-player-bar-height, 80px);
        padding: 0 var(--volumio-space-md, 16px);
        background: var(--card-background-color, #1e1e1e);
        border-top: 1px solid var(--divider-color, rgba(255,255,255,0.12));
        gap: var(--volumio-space-md, 16px);
      }

      /* ── Album art ─────────────────────────────── */
      .art {
        width: 56px;
        height: 56px;
        border-radius: 4px;
        object-fit: cover;
        cursor: pointer;
        flex-shrink: 0;
        background: var(--divider-color, #333);
      }

      .art-placeholder {
        width: 56px;
        height: 56px;
        border-radius: 4px;
        flex-shrink: 0;
        background: var(--divider-color, #333);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      .art-placeholder litgui-icon {
        --mdc-icon-size: 28px;
        color: var(--secondary-text-color);
      }

      /* ── Track info ────────────────────────────── */
      .track-info {
        flex: 0 1 200px;
        min-width: 0;
        cursor: pointer;
      }

      .track-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--primary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.3;
      }

      .track-artist {
        font-size: 12px;
        color: var(--secondary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.3;
      }

      .track-info-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 1 220px;
        min-width: 0;
      }

      .fav-btn {
        background: none;
        border: none;
        padding: 4px;
        cursor: pointer;
        color: var(--secondary-text-color);
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
      }

      .fav-btn litgui-icon {
        --mdc-icon-size: 20px;
      }

      .fav-btn.active {
        color: #e91e63;
      }

      /* ── Progress section ──────────────────────── */
      .progress-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 200px;
        gap: 2px;
      }

      .controls-row {
        display: flex;
        align-items: center;
        gap: var(--volumio-space-sm, 8px);
      }

      .ctrl-btn {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: background 0.15s;
      }

      .ctrl-btn:hover {
        background: var(--divider-color, rgba(255,255,255,0.08));
      }

      .ctrl-btn.play-pause {
        width: 42px;
        height: 42px;
      }

      .ctrl-btn.play-pause litgui-icon {
        --mdc-icon-size: 28px;
      }

      .ctrl-btn.active {
        color: var(--primary-color, #03a9f4);
      }

      .ctrl-btn litgui-icon {
        --mdc-icon-size: 22px;
      }

      .ctrl-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      .progress-row {
        display: flex;
        align-items: center;
        width: 100%;
        gap: 6px;
      }

      .time-label {
        font-size: 11px;
        color: var(--secondary-text-color);
        min-width: 36px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }

      .progress-track {
        flex: 1;
        height: 4px;
        background: var(--divider-color, rgba(255,255,255,0.15));
        border-radius: 2px;
        cursor: pointer;
        position: relative;
        transition: height 0.1s;
      }

      .progress-track:hover {
        height: 6px;
      }

      .progress-fill {
        height: 100%;
        background: var(--primary-color, #03a9f4);
        border-radius: 2px;
        transition: none;
        position: relative;
      }

      .progress-thumb {
        position: absolute;
        right: -6px;
        top: 50%;
        transform: translateY(-50%);
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--primary-color, #03a9f4);
        opacity: 0;
        transition: opacity 0.1s;
      }

      .progress-track:hover .progress-thumb {
        opacity: 1;
      }

      /* ── Right section (quality, volume) ────────── */
      .right-section {
        display: flex;
        align-items: center;
        gap: var(--volumio-space-sm, 8px);
        flex-shrink: 0;
      }

      .quality-source {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
      }

      .volume-section {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .vol-btn {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }

      .vol-btn:hover {
        background: var(--divider-color, rgba(255,255,255,0.08));
      }

      .vol-btn litgui-icon {
        --mdc-icon-size: 20px;
      }

      .vol-slider {
        width: 100px;
        height: 4px;
        -webkit-appearance: none;
        appearance: none;
        background: var(--divider-color, rgba(255,255,255,0.15));
        border-radius: 2px;
        outline: none;
        cursor: pointer;
      }

      .vol-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--primary-color, #03a9f4);
        cursor: pointer;
      }

      .vol-slider::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--primary-color, #03a9f4);
        cursor: pointer;
        border: none;
      }

      /* ── Empty state ────────────────────────────── */
      .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: var(--volumio-player-bar-height, 80px);
        background: var(--card-background-color, #1e1e1e);
        border-top: 1px solid var(--divider-color, rgba(255,255,255,0.12));
        color: var(--secondary-text-color);
        font-size: 14px;
        gap: 8px;
      }

      .empty-state litgui-icon {
        --mdc-icon-size: 20px;
      }

      /* ── Responsive ─────────────────────────────── */
      @media (max-width: 1024px) {
        .quality-source {
          display: none;
        }
      }

      @media (max-width: 768px) {
        .player-bar {
          flex-wrap: wrap;
          height: auto;
          min-height: var(--volumio-player-bar-height, 80px);
          padding: var(--volumio-space-sm, 8px) var(--volumio-space-md, 16px);
          gap: var(--volumio-space-sm, 8px);
        }

        .progress-section {
          order: 10;
          width: 100%;
          flex: 1 1 100%;
          min-width: 0;
        }

        .volume-section {
          display: none;
        }
      }

      /* ── Skeleton / loading state ──────────────── */
      @keyframes shimmer {
        0% { opacity: 0.3; }
        50% { opacity: 0.15; }
        100% { opacity: 0.3; }
      }

      .skeleton-bar-row {
        display: flex;
        align-items: center;
        gap: var(--volumio-space-md, 16px);
        height: var(--volumio-player-bar-height, 80px);
        padding: var(--volumio-space-sm, 8px) var(--volumio-space-md, 16px);
        background: var(--card-background-color, #1e1e1e);
        border-top: 1px solid var(--divider-color, rgba(255,255,255,0.12));
      }

      .skeleton-art {
        width: 56px;
        height: 56px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
        flex: 0 0 auto;
      }

      .skeleton-info {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 0 1 220px;
      }

      .skeleton-bar {
        height: 12px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-bar.title { width: 70%; height: 14px; }
      .skeleton-bar.artist { width: 50%; }

      .skeleton-progress {
        flex: 1;
        height: 4px;
        border-radius: 2px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      /* ── Mini mode (T48 Phase 2a) ──────────── */
      .mini-bar {
        box-sizing: border-box;
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        height: calc(var(--volumio-mobile-mini-height, 64px) + env(safe-area-inset-bottom, 0px));
        padding: 0 12px env(safe-area-inset-bottom, 0px);
        background: var(--card-background-color, #1a1a1a);
      }
      .mini-progress {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: var(--divider-color, rgba(255, 255, 255, 0.12));
      }
      .mini-progress-fill {
        height: 100%;
        background: var(--primary-color, #03a9f4);
      }
      .mini-art {
        width: 40px;
        height: 40px;
        border-radius: 6px;
        object-fit: cover;
        flex: 0 0 auto;
        background: var(--divider-color, #333);
      }
      .mini-art-ph {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .mini-art-ph litgui-icon {
        --mdc-icon-size: 22px;
        color: var(--secondary-text-color);
      }
      .mini-main {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
      }
      .mini-info {
        flex: 1;
        min-width: 0;
      }
      .mini-title {
        font-size: 13.5px;
        font-weight: 500;
        color: var(--primary-text-color);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
      }
      .mini-artist {
        font-size: 12px;
        color: var(--secondary-text-color);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
      }
      .mini-play {
        width: 44px;
        height: 44px;
        flex: 0 0 auto;
        border: none;
        background: transparent;
        color: var(--primary-text-color);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 0;
      }
      .mini-play litgui-icon {
        --mdc-icon-size: 30px;
      }

      /* ── Mini controls (T48 Phase 2c) ──────── */
      .mini-controls {
        position: relative;
        display: flex;
        align-items: center;
        gap: 2px;
        flex: 0 0 auto;
      }
      .mini-controls .ctrl {
        width: 40px;
        height: 40px;
        flex: 0 0 auto;
        border: none;
        background: transparent;
        color: var(--primary-text-color);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 0;
        border-radius: 6px;
      }
      .mini-controls .ctrl:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }
      .mini-controls .ctrl.active {
        color: var(--primary-color, #03a9f4);
      }
      .mini-controls .ctrl litgui-icon {
        --mdc-icon-size: 24px;
      }

      .mini-vol-pop {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 48px;
        background: var(--card-background-color, #1a1a1a);
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        border-radius: 10px;
        padding: 12px 8px;
        display: flex;
        justify-content: center;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        z-index: 20;
      }
      .mini-vol-slider {
        writing-mode: vertical-lr;
        direction: rtl;
        width: 24px;
        height: 120px;
      }

      .mini-menu {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        min-width: 180px;
        background: var(--card-background-color, #1a1a1a);
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        border-radius: 10px;
        padding: 4px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        z-index: 20;
      }
      .mini-menu-row {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 44px;
        padding: 0 12px;
        border: none;
        background: transparent;
        color: var(--primary-text-color);
        width: 100%;
        cursor: pointer;
        border-radius: 6px;
        font-size: 14px;
      }
      .mini-menu-row:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }
      .mini-menu-row.active {
        color: var(--primary-color, #03a9f4);
      }
      .mini-menu-row litgui-icon {
        --mdc-icon-size: 22px;
        flex: 0 0 auto;
      }
      .mini-menu-row .row-label-trailing {
        margin-left: auto;
        color: var(--secondary-text-color);
        font-size: 12px;
      }
    `}constructor(){super(),this.playerState="idle",this.title="",this.artist="",this.albumArt="",this.duration=0,this.position=0,this.positionUpdatedAt="",this.volume=0,this.muted=!1,this.shuffle=!1,this.repeat="off",this.quality=null,this.source="",this.volumeEnabled=!0,this.isFavorite=!1,this.mini=!1,this._displayPosition=0,this._isDragging=!1,this._rafId=null,this._miniVolOpen=!1,this._miniMenuOpen=!1}connectedCallback(){super.connectedCallback(),this._startProgressAnimation()}disconnectedCallback(){super.disconnectedCallback(),this._stopProgressAnimation()}updated(t){(t.has("position")||t.has("positionUpdatedAt")||t.has("playerState"))&&(this._isDragging||(this._displayPosition=this.position||0))}_startProgressAnimation(){const t=()=>{if("playing"===this.playerState&&!this._isDragging&&this.positionUpdatedAt){const t=new Date(this.positionUpdatedAt).getTime(),e=(Date.now()-t)/1e3,i=(this.position||0)+e;this._displayPosition=Math.min(i,this.duration||1/0)}this._rafId=requestAnimationFrame(t)};this._rafId=requestAnimationFrame(t)}_stopProgressAnimation(){this._rafId&&(cancelAnimationFrame(this._rafId),this._rafId=null)}render(){if(this.mini)return this._renderMini();if("unavailable"===this.playerState)return N`
        <div class="skeleton-bar-row" aria-busy="true" aria-label="Loading">
          <div class="skeleton-art"></div>
          <div class="skeleton-info">
            <div class="skeleton-bar title"></div>
            <div class="skeleton-bar artist"></div>
          </div>
          <div class="skeleton-progress"></div>
        </div>
      `;if(!("playing"===this.playerState||"paused"===this.playerState)&&!this.title)return N`
        <div class="empty-state">
          <litgui-icon icon="mdi:music-note-off"></litgui-icon>
          <span>Nothing playing</span>
        </div>
      `;const t="playing"===this.playerState,e=this.duration>0?Math.min(100,this._displayPosition/this.duration*100):0,i="one"===this.repeat?"mdi:repeat-once":"mdi:repeat",s="off"!==this.repeat,a=this.muted?"mdi:volume-mute":"mdi:volume-high";return N`
      <div class="player-bar">
        ${this.albumArt?N`<img
              class="art"
              src="${this.albumArt}"
              alt="Album art"
              @click=${this._goToNowPlaying}
              @error=${this._onArtError}
            />`:N`<div class="art-placeholder" @click=${this._goToNowPlaying}>
              <litgui-icon icon="mdi:music-note"></litgui-icon>
            </div>`}

        <div class="track-info-wrap">
          <div class="track-info" @click=${this._goToNowPlaying}>
            <div class="track-title">${this.title||"—"}</div>
            <div class="track-artist">${this.artist||""}</div>
          </div>
          <button
            class="fav-btn ${this.isFavorite?"active":""}"
            @click=${this._toggleFavorite}
            aria-label="${this.isFavorite?"Remove from favorites":"Add to favorites"}"
            title="${this.isFavorite?"Remove from favorites":"Add to favorites"}"
          >
            <litgui-icon icon="${this.isFavorite?"mdi:heart":"mdi:heart-outline"}"></litgui-icon>
          </button>
        </div>

        <div class="progress-section">
          <div class="controls-row">
            <button
              class="ctrl-btn ${this.shuffle?"active":""}"
              @click=${()=>this._command("shuffle_set",!this.shuffle)}
              title="Shuffle ${this.shuffle?"on":"off"}"
              aria-label="Shuffle: ${this.shuffle?"on":"off"}"
            >
              <litgui-icon icon="mdi:shuffle-variant"></litgui-icon>
            </button>

            <button class="ctrl-btn" @click=${()=>this._command("prev")} aria-label="Previous track">
              <litgui-icon icon="mdi:skip-previous"></litgui-icon>
            </button>

            <button class="ctrl-btn play-pause" @click=${()=>this._command("play_pause")} aria-label="${t?"Pause":"Play"}">
              <litgui-icon icon="${t?"mdi:pause":"mdi:play"}"></litgui-icon>
            </button>

            <button class="ctrl-btn" @click=${()=>this._command("next")} aria-label="Next track">
              <litgui-icon icon="mdi:skip-next"></litgui-icon>
            </button>

            <button
              class="ctrl-btn ${s?"active":""}"
              @click=${()=>this._cycleRepeat()}
              title="Repeat: ${this.repeat}"
              aria-label="Repeat: ${this.repeat}"
            >
              <litgui-icon icon="${i}"></litgui-icon>
            </button>
          </div>

          <div class="progress-row">
            <span class="time-label">${this._formatTime(this._displayPosition)}</span>
            <div
              class="progress-track"
              @click=${this._onProgressClick}
              aria-label="Playback progress: ${this._formatTime(this._displayPosition)} of ${this._formatTime(this.duration)}"
              role="slider"
              aria-valuemin="0"
              aria-valuemax="${this.duration||0}"
              aria-valuenow="${Math.floor(this._displayPosition)}"
            >
              <div class="progress-fill" style="width: ${e}%">
                <div class="progress-thumb"></div>
              </div>
            </div>
            <span class="time-label">${this._formatTime(this.duration)}</span>
          </div>
        </div>

        <div class="right-section">
          <div class="quality-source">
            <volumio-quality-badge .quality=${this.quality}></volumio-quality-badge>
            <volumio-source-badge .source=${this.source}></volumio-source-badge>
          </div>

          ${this.volumeEnabled?N`
            <div class="volume-section">
              <button
                class="vol-btn"
                @click=${()=>this._command("mute_toggle")}
                aria-label="Volume: ${this.muted?"muted":this.volume+"%"}"
              >
                <litgui-icon icon="${a}"></litgui-icon>
              </button>
              <input
                class="vol-slider"
                type="range"
                min="0"
                max="100"
                .value=${String(this.volume)}
                @input=${this._onVolumeInput}
                @change=${this._onVolumeChange}
                aria-label="Volume: ${this.volume}%"
              />
            </div>
          `:""}
        </div>
      </div>
    `}_renderMini(){if(!("playing"===this.playerState||"paused"===this.playerState))return N``;const t="playing"===this.playerState,e=this.duration>0?Math.min(100,this._displayPosition/this.duration*100):0,i="one"===this.repeat?"One":"all"===this.repeat?"All":"Off";return N`
      <div class="mini-bar" @click=${()=>{this._miniVolOpen=!1,this._miniMenuOpen=!1}}>
        <div class="mini-progress"><div class="mini-progress-fill" style="width:${e}%"></div></div>
        <div class="mini-main" @click=${this._goToNowPlaying}>
          ${this.albumArt?N`<img class="mini-art" src="${this.albumArt}" alt="" />`:N`<div class="mini-art mini-art-ph"><litgui-icon icon="mdi:music-note"></litgui-icon></div>`}
          <div class="mini-info">
            <div class="mini-title">${this.title||"—"}</div>
            <div class="mini-artist">${this.artist||""}</div>
          </div>
        </div>
        <div class="mini-controls">
          <button class="ctrl"
            @click=${t=>{t.stopPropagation(),this._command("prev")}}
            aria-label="Previous track"
          >
            <litgui-icon icon="mdi:skip-previous"></litgui-icon>
          </button>
          <button class="ctrl"
            @click=${t=>{t.stopPropagation(),this._command("play_pause")}}
            aria-label="${t?"Pause":"Play"}"
          >
            <litgui-icon icon="${t?"mdi:pause":"mdi:play"}"></litgui-icon>
          </button>
          <button class="ctrl"
            @click=${t=>{t.stopPropagation(),this._command("next")}}
            aria-label="Next track"
          >
            <litgui-icon icon="mdi:skip-next"></litgui-icon>
          </button>
          ${this.volumeEnabled?N`
            <button class="ctrl ${this._miniVolOpen?"active":""}"
              @click=${t=>{t.stopPropagation(),this._miniVolOpen=!this._miniVolOpen,this._miniMenuOpen=!1}}
              aria-label="Volume"
              aria-expanded=${this._miniVolOpen?"true":"false"}
            >
              <litgui-icon icon="${this.muted?"mdi:volume-mute":"mdi:volume-high"}"></litgui-icon>
            </button>
          `:""}
          <button class="ctrl ${this._miniMenuOpen?"active":""}"
            @click=${t=>{t.stopPropagation(),this._miniMenuOpen=!this._miniMenuOpen,this._miniVolOpen=!1}}
            aria-label="More controls"
            aria-expanded=${this._miniMenuOpen?"true":"false"}
          >
            <litgui-icon icon="mdi:dots-vertical"></litgui-icon>
          </button>
          ${this.volumeEnabled&&this._miniVolOpen?N`
            <div class="mini-vol-pop" @click=${t=>t.stopPropagation()}>
              <input class="mini-vol-slider" type="range" min="0" max="100"
                .value=${String(this.volume)}
                @input=${this._onVolumeInput} @change=${this._onVolumeChange}
                aria-label="Volume: ${this.volume}%" />
            </div>
          `:""}
          ${this._miniMenuOpen?N`
            <div class="mini-menu" @click=${t=>t.stopPropagation()}>
              <button class="mini-menu-row ${this.shuffle?"active":""}"
                @click=${t=>{t.stopPropagation(),this._command("shuffle_set",!this.shuffle)}}
              >
                <litgui-icon icon="mdi:shuffle-variant"></litgui-icon>
                <span>Shuffle</span>
                <span class="row-label-trailing">${this.shuffle?"On":"Off"}</span>
              </button>
              <button class="mini-menu-row ${"off"!==this.repeat?"active":""}"
                @click=${t=>{t.stopPropagation(),this._cycleRepeat()}}
              >
                <litgui-icon icon="${"one"===this.repeat?"mdi:repeat-once":"mdi:repeat"}"></litgui-icon>
                <span>Repeat</span>
                <span class="row-label-trailing">${i}</span>
              </button>
              <button class="mini-menu-row ${this.isFavorite?"active":""}"
                @click=${t=>this._toggleFavorite(t)}
              >
                <litgui-icon icon="${this.isFavorite?"mdi:heart":"mdi:heart-outline"}"></litgui-icon>
                <span>Favorite</span>
              </button>
            </div>
          `:""}
        </div>
      </div>
    `}_command(t,e){this.dispatchEvent(new CustomEvent("volumio-command",{detail:{command:t,value:e},bubbles:!0,composed:!0}))}_cycleRepeat(){const t="off"===this.repeat?"all":"all"===this.repeat?"one":"off";this._command("repeat_set",t)}_onProgressClick(t){const e=t.currentTarget.getBoundingClientRect(),i=Math.max(0,Math.min(1,(t.clientX-e.left)/e.width)),s=Math.floor(i*(this.duration||0));this._command("seek",s)}_onVolumeInput(t){}_onVolumeChange(t){const e=parseInt(t.target.value,10);this._command("volume_set",e)}_goToNowPlaying(){this.dispatchEvent(new CustomEvent("volumio-navigate",{detail:{view:"now-playing"},bubbles:!0,composed:!0}))}_toggleFavorite(t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("volumio-toggle-favorite",{bubbles:!0,composed:!0}))}_onArtError(t){t.target.style.display="none";const e=document.createElement("div");e.className="art-placeholder",e.innerHTML='<litgui-icon icon="mdi:music-note"></litgui-icon>',t.target.parentNode.insertBefore(e,t.target)}_formatTime(t){if(!t||t<=0)return"0:00";const e=Math.floor(t);return`${Math.floor(e/60)}:${(e%60).toString().padStart(2,"0")}`}});customElements.define("volumio-now-playing",class extends rt{static get properties(){return{playerState:{type:String,attribute:"player-state"},title:{type:String},artist:{type:String},album:{type:String},albumArt:{type:String,attribute:"album-art"},quality:{type:Object},source:{type:String},isFavorite:{type:Boolean,attribute:"is-favorite"},_dominantColor:{type:String,state:!0},_showLightbox:{type:Boolean,state:!0}}}static get styles(){return o`
      :host {
        display: block;
        height: 100%;
        position: relative;
        overflow: hidden;
      }

      .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        padding: var(--volumio-space-xl, 32px);
        position: relative;
        z-index: 1;
      }

      /* ── UltraBlur background ──────────────────── */
      .ultra-blur {
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
      }

      .ultra-blur-gradient {
        position: absolute;
        inset: 0;
        opacity: 0.5;
        filter: blur(120px);
        transition: background 1s ease;
      }

      .ultra-blur-overlay {
        position: absolute;
        inset: 0;
        background: radial-gradient(
          ellipse at center,
          transparent 30%,
          var(--primary-background-color, #121212) 100%
        );
      }

      /* ── Album art ─────────────────────────────── */
      .art-container {
        position: relative;
        margin-bottom: var(--volumio-space-lg, 24px);
        max-width: 400px;
        width: 50%;
        min-width: 200px;
        aspect-ratio: 1;
        cursor: pointer;
      }

      .art {
        width: 100%;
        height: 100%;
        border-radius: 6px;
        object-fit: cover;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
        transition: opacity 0.3s, box-shadow 4s ease;
      }

      .art.playing {
        animation: artPulse 4s ease-in-out infinite;
      }

      .art.paused {
        opacity: 0.85;
      }

      @keyframes artPulse {
        0%, 100% { box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5); }
        50% { box-shadow: 0 6px 32px rgba(0, 0, 0, 0.6); }
      }

      .art-placeholder {
        width: 100%;
        height: 100%;
        border-radius: 6px;
        background: var(--card-background-color, #2a2a2a);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .art-placeholder litgui-icon {
        --mdc-icon-size: 80px;
        color: var(--secondary-text-color);
        opacity: 0.3;
      }

      /* ── Track info ────────────────────────────── */
      .info {
        text-align: center;
        max-width: 500px;
        width: 100%;
      }

      .title-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--volumio-space-sm, 8px);
        margin-bottom: var(--volumio-space-sm, 8px);
      }

      .track-title {
        font-size: 24px;
        font-weight: 700;
        color: var(--primary-text-color);
        line-height: 1.3;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .fav-btn {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: none;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        padding: 0;
        transition: transform 0.3s ease;
      }

      .fav-btn:hover {
        transform: scale(1.1);
      }

      .fav-btn litgui-icon {
        --mdc-icon-size: 24px;
      }

      .fav-btn.active litgui-icon {
        color: #e91e63;
      }

      .fav-btn:not(.active) litgui-icon {
        color: var(--secondary-text-color);
      }

      .track-artist {
        font-size: 18px;
        font-weight: 500;
        color: var(--secondary-text-color);
        line-height: 1.3;
        margin-bottom: var(--volumio-space-xs, 4px);
        cursor: pointer;
      }

      .track-artist:hover {
        color: var(--primary-text-color);
        text-decoration: underline;
      }

      .track-album {
        font-size: 16px;
        color: var(--secondary-text-color);
        line-height: 1.3;
        margin-bottom: var(--volumio-space-md, 16px);
        cursor: pointer;
      }

      .track-album:hover {
        color: var(--primary-text-color);
        text-decoration: underline;
      }

      .quality-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--volumio-space-sm, 8px);
      }

      /* ── Empty / stopped state ─────────────────── */
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        padding: var(--volumio-space-xxl, 48px);
        text-align: center;
        gap: var(--volumio-space-md, 16px);
      }

      .empty-state litgui-icon {
        --mdc-icon-size: 48px;
        color: var(--secondary-text-color);
        opacity: 0.4;
      }

      .empty-state .message {
        font-size: 16px;
        color: var(--secondary-text-color);
      }

      .browse-btn {
        padding: 10px 24px;
        border-radius: 20px;
        border: none;
        background: var(--primary-color, #03a9f4);
        color: #fff;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.2s;
      }

      .browse-btn:hover {
        opacity: 0.85;
      }

      /* ── Lightbox ──────────────────────────────── */
      .lightbox {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.9);
        cursor: pointer;
      }

      .lightbox img {
        max-width: 90vw;
        max-height: 90vh;
        border-radius: 8px;
        box-shadow: 0 8px 48px rgba(0, 0, 0, 0.8);
      }

      @media (prefers-reduced-motion: reduce) {
        .art.playing {
          animation: none;
        }
      }

      /* ── Skeleton / loading state ──────────────── */
      @keyframes shimmer {
        0% { opacity: 0.3; }
        50% { opacity: 0.15; }
        100% { opacity: 0.3; }
      }

      .skeleton {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--volumio-space-xxl, 48px);
        gap: var(--volumio-space-md, 16px);
      }

      .skeleton-art {
        width: 50%;
        max-width: 400px;
        min-width: 200px;
        aspect-ratio: 1;
        border-radius: 6px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-bar {
        height: 14px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-bar.title { width: 60%; height: 22px; }
      .skeleton-bar.artist { width: 40%; }
      .skeleton-bar.album { width: 30%; }
    `}constructor(){super(),this.playerState="idle",this.title="",this.artist="",this.album="",this.albumArt="",this.quality=null,this.source="",this.isFavorite=!1,this._dominantColor=null,this._showLightbox=!1,this._canvas=null}updated(t){t.has("albumArt")&&this.albumArt&&this._extractDominantColor(this.albumArt)}render(){if("unavailable"===this.playerState)return this._renderSkeleton();return"playing"===this.playerState||"paused"===this.playerState||this.title?N`
      <div class="ultra-blur">
        <div
          class="ultra-blur-gradient"
          style="background: ${this._dominantColor?`radial-gradient(ellipse at 50% 40%, ${this._dominantColor} 0%, transparent 85%)`:"transparent"}"
        ></div>
        <div class="ultra-blur-overlay"></div>
      </div>

      <div class="container">
        <div class="art-container" @click=${this._toggleLightbox}>
          ${this.albumArt?N`<img
                class="art ${this.playerState}"
                src="${this.albumArt}"
                alt="Album art for ${this.album||this.title}"
                @error=${this._onArtError}
              />`:N`<div class="art-placeholder">
                <litgui-icon icon="mdi:music-note"></litgui-icon>
              </div>`}
        </div>

        <div class="info">
          <div class="title-row">
            <span class="track-title">${this.title||"—"}</span>
            <button
              class="fav-btn ${this.isFavorite?"active":""}"
              @click=${this._toggleFavorite}
              aria-label="${this.isFavorite?"Remove from favorites":"Add to favorites"}"
            >
              <litgui-icon icon="${this.isFavorite?"mdi:heart":"mdi:heart-outline"}"></litgui-icon>
            </button>
          </div>

          ${this.artist?N`
            <div class="track-artist" @click=${this._goToArtist}>${this.artist}</div>
          `:""}

          ${this.album?N`
            <div class="track-album" @click=${this._goToAlbum}>${this.album}</div>
          `:""}

          <div class="quality-row">
            <volumio-quality-badge .quality=${this.quality} size="large"></volumio-quality-badge>
            <volumio-source-badge .source=${this.source}></volumio-source-badge>
          </div>
        </div>
      </div>

      ${this._showLightbox&&this.albumArt?N`
        <div class="lightbox" @click=${this._toggleLightbox} @keydown=${this._onLightboxKey}>
          <img src="${this.albumArt}" alt="Full size album art" />
        </div>
      `:""}
    `:this._renderEmpty()}_renderEmpty(){return N`
      <div class="empty-state">
        <litgui-icon icon="mdi:music-note-off"></litgui-icon>
        <div class="message">Nothing playing</div>
        <button class="browse-btn" @click=${this._goToBrowse}>Browse Music</button>
      </div>
    `}_renderSkeleton(){return N`
      <div class="skeleton" aria-busy="true" aria-label="Loading">
        <div class="skeleton-art"></div>
        <div class="skeleton-bar title"></div>
        <div class="skeleton-bar artist"></div>
        <div class="skeleton-bar album"></div>
      </div>
    `}async _extractDominantColor(t){if(t)try{const e=new Image;e.src=t,await new Promise((t,i)=>{e.onload=t,e.onerror=i}),this._canvas||(this._canvas=document.createElement("canvas"));const i=this._canvas,s=i.getContext("2d",{willReadFrequently:!0}),a=10;i.width=a,i.height=a,s.drawImage(e,0,0,a,a);const o=s.getImageData(0,0,a,a).data;let r=0,n=0,l=0;const c=a*a;for(let t=0;t<o.length;t+=4)r+=o[t],n+=o[t+1],l+=o[t+2];r=Math.round(r/c),n=Math.round(n/c),l=Math.round(l/c);const d=Math.max(r,n,l)/255,u=Math.min(r,n,l)/255;let p=0,h=0,m=(d+u)/2;if(d!==u){const t=d-u;h=m>.5?t/(2-d-u):t/(d+u);const e=r/255,i=n/255,s=l/255;p=e===d?((i-s)/t+(i<s?6:0))/6:i===d?((s-e)/t+2)/6:((e-i)/t+4)/6}m=Math.max(m,.4),h=Math.min(1.3*h,1);const v=(t,e,i)=>(i<0&&(i+=1),i>1&&(i-=1),i<1/6?t+6*(e-t)*i:i<.5?e:i<2/3?t+(e-t)*(2/3-i)*6:t),g=m<.5?m*(1+h):m+h-m*h,b=2*m-g;r=Math.round(255*v(b,g,p+1/3)),n=Math.round(255*v(b,g,p)),l=Math.round(255*v(b,g,p-1/3)),this._dominantColor=`rgb(${r}, ${n}, ${l})`}catch{this._dominantColor=null}else this._dominantColor=null}_toggleFavorite(){this.dispatchEvent(new CustomEvent("volumio-toggle-favorite",{bubbles:!0,composed:!0}))}_toggleLightbox(){this._showLightbox=!this._showLightbox}_onLightboxKey(t){"Escape"===t.key&&(this._showLightbox=!1)}_goToArtist(){this.dispatchEvent(new CustomEvent("volumio-navigate",{detail:{view:"artist-detail",artist:this.artist},bubbles:!0,composed:!0}))}_goToAlbum(){this.dispatchEvent(new CustomEvent("volumio-navigate",{detail:{view:"album-detail",album:this.album},bubbles:!0,composed:!0}))}_goToBrowse(){this.dispatchEvent(new CustomEvent("volumio-navigate",{detail:{view:"browse"},bubbles:!0,composed:!0}))}_onArtError(t){t.target.style.display="none"}});const Rt={mpd:"mdi:folder-music",webradio:"mdi:radio",podcast:"mdi:podcast",spotify:"mdi:spotify",spop:"mdi:spotify",youtube:"mdi:youtube",youtube2:"mdi:youtube",tidal:"mdi:music-box",qobuz:"mdi:music-box",music_service:"mdi:music-box"};customElements.define("volumio-browse-source-grid",class extends rt{static get properties(){return{sources:{type:Array},volumioUrl:{type:String,attribute:"volumio-url"},configEntryId:{type:String,attribute:"config-entry-id"}}}static get styles(){return o`
      :host {
        display: block;
        padding: var(--volumio-space-lg, 24px);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: var(--volumio-space-md, 16px);
        max-width: 960px;
      }

      .source-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        aspect-ratio: 1;
        border-radius: 12px;
        background: var(--card-background-color, #1e1e1e);
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
        padding: var(--volumio-space-md, 16px);
        gap: var(--volumio-space-sm, 8px);
        text-align: center;
      }

      .source-card:hover {
        transform: scale(1.03);
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      }

      .source-icon {
        width: 64px;
        height: 64px;
        border-radius: 12px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--primary-background-color, #121212);
      }

      .source-icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .source-icon litgui-icon {
        --mdc-icon-size: 32px;
        color: var(--secondary-text-color);
      }

      .source-name {
        font-size: 14px;
        font-weight: 500;
        color: var(--primary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--volumio-space-xxl, 48px);
        text-align: center;
        gap: var(--volumio-space-md, 16px);
      }

      .empty-state litgui-icon {
        --mdc-icon-size: 48px;
        color: var(--secondary-text-color);
        opacity: 0.3;
      }

      .empty-state .message {
        font-size: 16px;
        color: var(--secondary-text-color);
      }
    `}constructor(){super(),this.sources=[],this.volumioUrl=""}render(){return this.sources&&0!==this.sources.length?N`
      <div class="grid">
        ${this.sources.map(t=>this._renderSourceCard(t))}
      </div>
    `:N`
        <div class="empty-state">
          <litgui-icon icon="mdi:music-box-multiple-outline"></litgui-icon>
          <div class="message">No music sources configured</div>
        </div>
      `}_renderSourceCard(t){const e=Rt[t.plugin_name]||Rt[t.plugin_type]||"mdi:music-box",i=xt(t.albumart,this.volumioUrl,this.configEntryId);return N`
      <div
        class="source-card"
        @click=${()=>this._selectSource(t)}
        title="${t.name}"
      >
        <div class="source-icon">
          ${i?N`<img
                src="${i}"
                alt="${t.name}"
                @error=${this._onIconError}
              />`:N`<litgui-icon icon="${e}"></litgui-icon>`}
        </div>
        <div class="source-name">${t.name}</div>
      </div>
    `}_selectSource(t){this.dispatchEvent(new CustomEvent("volumio-source-select",{detail:{uri:t.uri,name:t.name,plugin_name:t.plugin_name},bubbles:!0,composed:!0}))}_onIconError(t){const e=t.target.parentElement;t.target.remove(),e.innerHTML='<litgui-icon icon="mdi:music-box"></litgui-icon>'}});const Ot=new Map,jt=new Map,Ft=new Map,Zt=[];let Gt=0;function Kt(t,{timeoutMs:e=4e3}={}){if(!t)return Promise.reject(new Error("loadArt: empty url"));const i=Ot.get(t);if(i)return i.refs++,Promise.resolve(i.blobUrl);const s=Ft.get(t);if(void 0!==s){if(Date.now()<s)return Promise.reject(new Error("loadArt: recently failed: "+t));Ft.delete(t)}let a=jt.get(t);return a||(a=function(t,e){return new Promise((i,s)=>{Zt.push({url:t,timeoutMs:e,resolve:i,reject:s}),Yt()})}(t,e).then(e=>(Ot.set(t,{blobUrl:e,refs:0}),jt.delete(t),e),e=>{throw Ft.set(t,Date.now()+3e4),jt.delete(t),e}),jt.set(t,a)),a.then(e=>{const i=Ot.get(t);return i&&i.refs++,e})}function Wt(t){if(!t)return;const e=Ot.get(t);e&&(e.refs--,e.refs<=0&&(URL.revokeObjectURL(e.blobUrl),Ot.delete(t)))}function Yt(){for(;Gt<5&&Zt.length>0;){const t=Zt.shift();Gt++,Xt(t.url,t.timeoutMs).then(t.resolve,t.reject).finally(()=>{Gt--,Yt()})}}async function Xt(t,e){const i=new AbortController,s=setTimeout(()=>i.abort(),e);try{const e=await fetch(t,{signal:i.signal});if(!e.ok)throw new Error("loadArt: HTTP "+e.status+" for "+t);const s=await e.blob();return URL.createObjectURL(s)}finally{clearTimeout(s)}}customElements.define("litgui-art",class extends rt{static get properties(){return{src:{type:String},icon:{type:String},alt:{type:String},_state:{state:!0},_blobUrl:{state:!0}}}static get styles(){return o`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        --mdc-icon-size: 48px;
      }

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .placeholder litgui-icon {
        color: var(--secondary-text-color);
        opacity: 0.3;
      }
    `}constructor(){super(),this.src="",this.icon="mdi:account-music",this.alt="",this._state="idle",this._blobUrl="",this._heldSrc="",this._observer=null,this._visible=!1}connectedCallback(){super.connectedCallback(),this._visible?this._load():this._observe()}disconnectedCallback(){super.disconnectedCallback(),this._teardownObserver(),this._release(),this._blobUrl="","loaded"===this._state&&(this._state="idle")}updated(t){t.has("src")&&void 0!==t.get("src")&&(this._release(),this._blobUrl="",this._state="idle",this._visible?this._load():this._observe())}render(){return"loaded"===this._state&&this._blobUrl?N`<img src="${this._blobUrl}" alt="${this.alt||""}" />`:N`
      <div class="placeholder">
        <litgui-icon icon="${this.icon}"></litgui-icon>
      </div>
    `}_observe(){this._observer||("undefined"!=typeof IntersectionObserver?(this._observer=new IntersectionObserver(t=>{for(const e of t)if(e.isIntersecting){this._onVisible();break}},{rootMargin:"200px"}),this._observer.observe(this)):this._onVisible())}_teardownObserver(){this._observer&&(this._observer.disconnect(),this._observer=null)}_onVisible(){this._visible=!0,this._teardownObserver(),this._load()}async _load(){const t=this.src;if(t){if(this._heldSrc!==t||"loaded"!==this._state){this._state="loading";try{const e=await Kt(t);if(this.src!==t||!this.isConnected)return void Wt(t);this._release(),this._heldSrc=t,this._blobUrl=e,this._state="loaded"}catch{this.src===t&&this.isConnected&&(this._state="error")}}}else this._state="idle"}_release(){this._heldSrc&&(Wt(this._heldSrc),this._heldSrc="")}});customElements.define("volumio-album-card",class extends rt{static get properties(){return{title:{type:String},artist:{type:String},albumart:{type:String},uri:{type:String},type:{type:String},quality:{type:Object},service:{type:String}}}static get styles(){return o`
      :host {
        display: block;
        width: 180px;
      }

      .card {
        cursor: pointer;
        border-radius: 6px;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        position: relative;
      }

      .card:hover {
        transform: scale(1.03);
      }

      .card:hover .play-overlay {
        opacity: 1;
      }

      .card:hover .art {
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
      }

      .art-container {
        position: relative;
        width: 100%;
        aspect-ratio: 1;
        border-radius: 6px;
        overflow: hidden;
        background: var(--card-background-color, #2a2a2a);
      }

      .art {
        width: 100%;
        height: 100%;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        transition: box-shadow 0.15s ease;
      }

      .play-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background: rgba(0, 0, 0, 0.4);
        opacity: 0;
        transition: opacity 0.15s ease;
        border-radius: 6px;
      }

      .play-btn,
      .queue-btn {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .play-btn {
        background: var(--primary-color, #03a9f4);
        color: #fff;
      }

      .play-btn litgui-icon {
        --mdc-icon-size: 22px;
      }

      .queue-btn {
        width: 36px;
        height: 36px;
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
      }

      .queue-btn:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .queue-btn litgui-icon {
        --mdc-icon-size: 18px;
      }

      .meta {
        padding: 8px 2px 0;
      }

      .card-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--primary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.3;
      }

      .card-artist {
        font-size: 13px;
        color: var(--secondary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.3;
        margin-top: 2px;
      }

      .card-quality {
        margin-top: 4px;
      }

      /* Folder variant */
      .card.folder .art-container {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }
    `}constructor(){super(),this.title="",this.artist="",this.albumart="",this.uri="",this.type="folder",this.quality=null,this.service=""}render(){const t="folder"===this.type||"category"===this.type,e=t?"mdi:folder-music":"mdi:music-note";return N`
      <div class="card ${t?"folder":""}" @click=${this._onClick} @contextmenu=${this._onContextMenu}>
        <div class="art-container">
          <litgui-art
            class="art"
            src="${this.albumart||""}"
            icon="${e}"
            alt="${this.title}"
          ></litgui-art>
          <div class="play-overlay">
            <button class="play-btn" @click=${this._onPlay} title="Play">
              <litgui-icon icon="mdi:play"></litgui-icon>
            </button>
            <button class="queue-btn" @click=${this._onDotsClick} title="More actions">
              <litgui-icon icon="mdi:dots-vertical"></litgui-icon>
            </button>
          </div>
        </div>
        <div class="meta">
          <div class="card-title" title="${this.title}">${this.title||"Unknown"}</div>
          ${this.artist?N`<div class="card-artist" title="${this.artist}">${this.artist}</div>`:""}
          ${this.quality&&"unknown"!==this.quality.tier?N`<div class="card-quality">
                <volumio-quality-badge .quality=${this.quality} size="small"></volumio-quality-badge>
              </div>`:""}
        </div>
      </div>
    `}_getItemData(){return{uri:this.uri,title:this.title,artist:this.artist,albumart:this.albumart,type:this.type,service:this.service}}_onClick(t){t.target.closest(".play-btn")||this.dispatchEvent(new CustomEvent("volumio-card-click",{detail:this._getItemData(),bubbles:!0,composed:!0}))}_onPlay(t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("volumio-card-play",{detail:this._getItemData(),bubbles:!0,composed:!0}))}_onDotsClick(t){t.stopPropagation(),t.preventDefault();const e=t.currentTarget.getBoundingClientRect();this._fireContextEvent(e.right,e.bottom)}_onContextMenu(t){t.preventDefault(),t.stopPropagation(),this._fireContextEvent(t.clientX,t.clientY)}_fireContextEvent(t,e){this.dispatchEvent(new CustomEvent("volumio-context-menu",{detail:{...this._getItemData(),x:t,y:e,context:"album_card"},bubbles:!0,composed:!0}))}});customElements.define("volumio-track-card",class extends rt{static get properties(){return{index:{type:Number},title:{type:String},artist:{type:String},album:{type:String},duration:{type:Number},uri:{type:String},albumart:{type:String},service:{type:String},type:{type:String},quality:{type:Object},isPlaying:{type:Boolean,attribute:"is-playing"},compact:{type:Boolean}}}static get styles(){return o`
      :host {
        display: block;
      }

      .row {
        display: grid;
        grid-template-columns: 40px 1fr 1fr 0.8fr auto 60px 32px;
        align-items: center;
        height: 48px;
        padding: 0 12px;
        cursor: pointer;
        transition: background 0.1s;
        position: relative;
        gap: 8px;
      }

      .row:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.06));
      }

      .row.playing {
        border-left: 3px solid var(--primary-color, #03a9f4);
      }

      .row.playing .cell-title {
        color: var(--primary-color, #03a9f4);
      }

      /* ── Cells ──────────────────────────── */
      .cell-num {
        font-size: 13px;
        color: var(--secondary-text-color);
        text-align: center;
        position: relative;
      }

      .cell-num .num-text {
        display: block;
      }

      .cell-num .play-icon {
        display: none;
        color: var(--primary-text-color);
      }

      .row:hover .cell-num .num-text {
        display: none;
      }

      .row:hover .cell-num .play-icon {
        display: block;
      }

      .row.playing .cell-num .num-text {
        display: none;
      }

      .row.playing .cell-num .eq-icon {
        display: block;
        color: var(--primary-color, #03a9f4);
      }

      .row.playing:not(:hover) .cell-num .play-icon {
        display: none;
      }

      .eq-icon {
        display: none;
      }

      .cell-num litgui-icon {
        --mdc-icon-size: 18px;
      }

      .cell-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--primary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cell-artist,
      .cell-album {
        font-size: 13px;
        color: var(--secondary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cell-quality {
        display: flex;
        align-items: center;
        justify-content: flex-end;
      }

      .cell-duration {
        font-size: 13px;
        color: var(--secondary-text-color);
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .cell-context {
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.1s;
      }

      .row:hover .cell-context {
        opacity: 1;
      }

      .context-btn {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: var(--secondary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }

      .context-btn:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
        color: var(--primary-text-color);
      }

      .context-btn litgui-icon {
        --mdc-icon-size: 18px;
      }

      /* ── Compact mode (browse — no quality/time/album) ── */
      .row.compact {
        grid-template-columns: 40px 1.5fr 1fr 32px;
      }

      .row.compact .cell-quality,
      .row.compact .cell-duration,
      .row.compact .cell-album {
        display: none;
      }

      /* ── Responsive (hide album & quality) ── */
      @media (max-width: 768px) {
        .row {
          grid-template-columns: 40px 1fr 0.8fr 60px 32px;
        }
        .cell-album,
        .cell-quality {
          display: none;
        }
      }

      @media (max-width: 480px) {
        .row {
          grid-template-columns: 32px 1fr 50px;
          gap: 4px;
        }
        .cell-artist,
        .cell-album,
        .cell-quality,
        .cell-context {
          display: none;
        }
      }
    `}constructor(){super(),this.index=0,this.title="",this.artist="",this.album="",this.duration=0,this.uri="",this.albumart="",this.service="",this.type="song",this.quality=null,this.isPlaying=!1,this.compact=!1}render(){return N`
      <div
        class="row ${this.isPlaying?"playing":""} ${this.compact?"compact":""}"
        @click=${this._onClick}
        @contextmenu=${this._onContextMenu}
      >
        <div class="cell-num">
          <span class="num-text">${this.index||""}</span>
          <litgui-icon class="play-icon" icon="mdi:play"></litgui-icon>
          <litgui-icon class="eq-icon" icon="mdi:equalizer"></litgui-icon>
        </div>
        <div class="cell-title" title="${this.title}">${this.title||"—"}</div>
        <div class="cell-artist" title="${this.artist}">${this.artist||""}</div>
        <div class="cell-album" title="${this.album}">${this.album||""}</div>
        <div class="cell-quality">
          ${this.quality&&"unknown"!==this.quality.tier?N`<volumio-quality-badge .quality=${this.quality} size="small"></volumio-quality-badge>`:""}
        </div>
        <div class="cell-duration">${this.duration?_t(this.duration):""}</div>
        <div class="cell-context">
          <button class="context-btn" @click=${this._onDotsClick} title="More actions">
            <litgui-icon icon="mdi:dots-vertical"></litgui-icon>
          </button>
        </div>
      </div>
    `}_getItemData(){return{uri:this.uri,title:this.title,artist:this.artist,album:this.album,albumart:this.albumart,service:this.service,type:this.type,index:this.index}}_onClick(){this.dispatchEvent(new CustomEvent("volumio-track-click",{detail:this._getItemData(),bubbles:!0,composed:!0}))}_onDotsClick(t){t.stopPropagation(),t.preventDefault();const e=t.currentTarget.getBoundingClientRect();this._fireContextEvent(e.right,e.bottom)}_onContextMenu(t){t.preventDefault(),t.stopPropagation(),this._fireContextEvent(t.clientX,t.clientY)}_fireContextEvent(t,e){this.dispatchEvent(new CustomEvent("volumio-context-menu",{detail:{...this._getItemData(),x:t,y:e,context:"track"},bubbles:!0,composed:!0}))}});customElements.define("volumio-browse-list",class extends rt{static get properties(){return{items:{type:Array},viewMode:{type:String,attribute:"view-mode"},loading:{type:Boolean},currentUri:{type:String,attribute:"current-uri"},volumioUrl:{type:String,attribute:"volumio-url"},configEntryId:{type:String,attribute:"config-entry-id"},_displayCount:{type:Number,state:!0}}}static get styles(){return o`
      :host {
        display: block;
        padding: var(--volumio-space-lg, 24px);
      }

      /* ── Toolbar ──────────────────────────── */
      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--volumio-space-md, 16px);
        gap: var(--volumio-space-sm, 8px);
      }

      .item-count {
        font-size: 13px;
        color: var(--secondary-text-color);
      }

      .toolbar-actions {
        display: flex;
        align-items: center;
        gap: var(--volumio-space-xs, 4px);
      }

      .view-btn {
        width: 36px;
        height: 36px;
        border-radius: 6px;
        border: none;
        background: transparent;
        color: var(--secondary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }

      .view-btn:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }

      .view-btn.active {
        color: var(--primary-color, #03a9f4);
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }

      .view-btn litgui-icon {
        --mdc-icon-size: 20px;
      }

      /* ── Grid layout ──────────────────────── */
      .browse-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--volumio-space-md, 16px);
      }

      /* ── List layout ──────────────────────── */
      .browse-list {
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
        border-radius: 8px;
        overflow: hidden;
      }

      .list-header {
        display: grid;
        grid-template-columns: 40px 1fr 1fr 0.8fr auto 60px 32px;
        align-items: center;
        height: 36px;
        padding: 0 12px;
        gap: 8px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--secondary-text-color);
        border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
        background: var(--card-background-color, #1e1e1e);
      }

      .list-header .hdr-duration {
        text-align: right;
      }

      /* ── Load more ────────────────────────── */
      .load-more {
        display: flex;
        justify-content: center;
        padding: var(--volumio-space-lg, 24px);
      }

      .load-more-btn {
        padding: 10px 32px;
        border-radius: 20px;
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        background: transparent;
        color: var(--primary-text-color);
        font-size: 14px;
        cursor: pointer;
        transition: background 0.15s;
      }

      .load-more-btn:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }

      /* ── Loading skeleton ─────────────────── */
      @keyframes shimmer {
        0% { opacity: 0.3; }
        50% { opacity: 0.15; }
        100% { opacity: 0.3; }
      }

      .skeleton-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--volumio-space-md, 16px);
      }

      .skeleton-card {
        aspect-ratio: 1;
        border-radius: 6px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-row {
        height: 48px;
        border-radius: 4px;
        margin-bottom: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--volumio-space-xxl, 48px);
        text-align: center;
        gap: var(--volumio-space-md, 16px);
      }

      .empty-state litgui-icon {
        --mdc-icon-size: 48px;
        color: var(--secondary-text-color);
        opacity: 0.3;
      }

      .empty-state .message {
        font-size: 16px;
        color: var(--secondary-text-color);
      }

      /* ── Alpha index ──────────────────────── */
      .browse-content {
        position: relative;
      }

      .alpha-index {
        position: fixed;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0;
        z-index: 50;
        padding: 4px 2px;
        border-radius: 12px;
        background: var(--card-background-color, rgba(30, 30, 30, 0.9));
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      /* When queue panel is pinned (>= 1400px), offset alpha index */
      @media (min-width: 1400px) {
        .alpha-index {
          right: 340px;
        }
      }

      .alpha-letter {
        width: 22px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 600;
        color: var(--secondary-text-color);
        cursor: pointer;
        border-radius: 4px;
        user-select: none;
        transition: color 0.1s, background 0.1s;
      }

      .alpha-letter:hover {
        color: var(--primary-text-color);
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }

      .alpha-letter.active {
        color: var(--primary-color, #03a9f4);
      }

      .alpha-letter.disabled {
        opacity: 0.2;
        cursor: default;
      }

      .alpha-letter.disabled:hover {
        color: var(--secondary-text-color);
        background: transparent;
      }

      @media (max-width: 768px) {
        .list-header {
          grid-template-columns: 40px 1fr 0.8fr 60px 32px;
        }
        .list-header .hdr-album,
        .list-header .hdr-quality {
          display: none;
        }
      }
    `}constructor(){super(),this.items=[],this.viewMode=wt("volumio-browse-view","grid"),this.loading=!1,this.currentUri="",this.volumioUrl="",this._displayCount=100}render(){if(this.loading)return this._renderSkeleton();if(!this.items||0===this.items.length)return N`
        <div class="empty-state">
          <litgui-icon icon="mdi:folder-open-outline"></litgui-icon>
          <div class="message">No items found</div>
        </div>
      `;const t=this.items.slice(0,this._displayCount),e=this.items.length>this._displayCount,i=this.items.length>20,s=i?this._buildAlphaMap():null;return N`
      <div class="toolbar">
        <span class="item-count">${this.items.length} item${1!==this.items.length?"s":""}</span>
        <div class="toolbar-actions">
          <button
            class="view-btn ${"grid"===this.viewMode?"active":""}"
            @click=${()=>this._setViewMode("grid")}
            title="Grid view"
          >
            <litgui-icon icon="mdi:view-grid"></litgui-icon>
          </button>
          <button
            class="view-btn ${"list"===this.viewMode?"active":""}"
            @click=${()=>this._setViewMode("list")}
            title="List view"
          >
            <litgui-icon icon="mdi:view-list"></litgui-icon>
          </button>
        </div>
      </div>

      <div class="browse-content">
        ${"grid"===this.viewMode?this._renderGrid(t):this._renderList(t)}

        ${e?N`
          <div class="load-more">
            <button class="load-more-btn" @click=${this._loadMore}>
              Show more (${this.items.length-this._displayCount} remaining)
            </button>
          </div>
        `:""}

        ${i?this._renderAlphaIndex(s):""}
      </div>
    `}updated(t){t.has("items")&&(this._displayCount=100)}_renderGrid(t){return N`
      <div class="browse-grid">
        ${t.map(t=>{const e=xt(t.albumart,this.volumioUrl,this.configEntryId),i=this._getItemLetter(t);return N`
            <volumio-album-card
              data-letter="${i}"
              title="${t.title||t.name||""}"
              artist="${t.artist||""}"
              albumart="${e}"
              uri="${t.uri||""}"
              type="${t.type||"folder"}"
              service="${t.service||""}"
              @volumio-card-click=${this._onItemClick}
              @volumio-card-play=${this._onItemPlay}
            ></volumio-album-card>
          `})}
      </div>
    `}_renderList(t){const e=!t.some(t=>t.duration>0);return N`
      <div class="browse-list">
        <div class="list-header" style="grid-template-columns: ${e?"40px 1.5fr 1fr 32px":"40px 1fr 1fr 0.8fr auto 60px 32px"};">
          <span>#</span>
          <span>Title</span>
          <span>Artist</span>
          ${e?"":N`
            <span class="hdr-album">Album</span>
            <span class="hdr-quality">Quality</span>
            <span class="hdr-duration">Time</span>
          `}
          <span></span>
        </div>
        ${t.map((t,i)=>{const s=xt(t.albumart,this.volumioUrl,this.configEntryId),a=bt(t),o=this._getItemLetter(t);return N`
            <volumio-track-card
              data-letter="${o}"
              .index=${i+1}
              title="${t.title||t.name||""}"
              artist="${t.artist||""}"
              album="${t.album||""}"
              .duration=${t.duration||0}
              uri="${t.uri||""}"
              albumart="${s}"
              service="${t.service||""}"
              type="${t.type||"folder"}"
              .quality=${a}
              ?compact=${e}
              ?is-playing=${this.currentUri&&t.uri===this.currentUri}
              @volumio-track-click=${this._onItemClick}
            ></volumio-track-card>
          `})}
      </div>
    `}_renderSkeleton(){return N`
      <div class="skeleton-grid" aria-busy="true" aria-label="Loading">
        ${Array(12).fill(0).map(()=>N`<div class="skeleton-card"></div>`)}
      </div>
    `}_setViewMode(t){this.viewMode=t,kt("volumio-browse-view",t),this.dispatchEvent(new CustomEvent("volumio-view-mode-change",{detail:{mode:t},bubbles:!0,composed:!0}))}_loadMore(){this._displayCount+=100}_onItemClick(t){t.stopPropagation();const e=t.detail;this.dispatchEvent(new CustomEvent("volumio-item-click",{detail:e,bubbles:!0,composed:!0}))}_onItemPlay(t){t.stopPropagation();const e=t.detail;this.dispatchEvent(new CustomEvent("volumio-item-play",{detail:e,bubbles:!0,composed:!0}))}_getItemLetter(t){const e=(t.title||t.name||"").trim();if(!e)return"#";const i=e.charAt(0).toUpperCase();return/[A-Z]/.test(i)?i:"#"}_buildAlphaMap(){const t=new Set;for(const e of this.items)t.add(this._getItemLetter(e));return t}_renderAlphaIndex(t){const e=["#",..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];return N`
      <div class="alpha-index">
        ${e.map(e=>{const i=t.has(e);return N`
            <div
              class="alpha-letter ${i?"":"disabled"}"
              @click=${()=>i&&this._scrollToLetter(e)}
            >${e}</div>
          `})}
      </div>
    `}_scrollToLetter(t){if(this._displayCount<this.items.length){const e=this.items.findIndex(e=>this._getItemLetter(e)===t);e>=this._displayCount&&(this._displayCount=Math.min(e+50,this.items.length))}this.updateComplete.then(()=>{const e=this.shadowRoot.querySelector(`[data-letter="${t}"]`);e&&e.scrollIntoView({behavior:"smooth",block:"start"})})}});customElements.define("volumio-album-detail",class extends rt{static get properties(){return{albumTitle:{type:String,attribute:"album-title"},albumArtist:{type:String,attribute:"album-artist"},albumArt:{type:String,attribute:"album-art"},albumUri:{type:String,attribute:"album-uri"},albumService:{type:String,attribute:"album-service"},tracks:{type:Array},loading:{type:Boolean},currentUri:{type:String,attribute:"current-uri"},quality:{type:Object},volumioUrl:{type:String,attribute:"volumio-url"},configEntryId:{type:String,attribute:"config-entry-id"},story:{type:String},credits:{type:Array,attribute:!1},storyLoading:{type:Boolean,attribute:"story-loading"},creditsLoading:{type:Boolean,attribute:"credits-loading"},_storyExpanded:{type:Boolean,state:!0},_creditsExpanded:{type:Boolean,state:!0}}}static get styles(){return o`
      :host {
        display: block;
        padding: var(--volumio-space-lg, 24px);
      }

      /* ── Header ──────────────────────────── */
      .album-header {
        display: flex;
        gap: var(--volumio-space-lg, 24px);
        margin-bottom: var(--volumio-space-xl, 32px);
      }

      .album-art-container {
        flex-shrink: 0;
        width: 250px;
        height: 250px;
        border-radius: 6px;
        overflow: hidden;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
      }

      .album-art-container img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .album-art-placeholder {
        width: 100%;
        height: 100%;
        background: var(--card-background-color, #2a2a2a);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .album-art-placeholder litgui-icon {
        --mdc-icon-size: 64px;
        color: var(--secondary-text-color);
        opacity: 0.3;
      }

      .album-meta {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: var(--volumio-space-xs, 4px);
        min-width: 0;
      }

      .meta-type {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--secondary-text-color);
      }

      .album-name {
        font-size: 28px;
        font-weight: 700;
        color: var(--primary-text-color);
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .album-artist-link {
        font-size: 16px;
        color: var(--secondary-text-color);
        cursor: pointer;
        transition: color 0.15s;
      }

      .album-artist-link:hover {
        color: var(--primary-text-color);
        text-decoration: underline;
      }

      .meta-details {
        display: flex;
        align-items: center;
        gap: var(--volumio-space-sm, 8px);
        flex-wrap: wrap;
        margin-top: var(--volumio-space-xs, 4px);
      }

      .meta-details .detail {
        font-size: 13px;
        color: var(--secondary-text-color);
      }

      .meta-details .sep {
        color: var(--secondary-text-color);
        opacity: 0.4;
      }

      .album-actions {
        display: flex;
        gap: var(--volumio-space-sm, 8px);
        margin-top: var(--volumio-space-md, 16px);
      }

      .action-btn {
        padding: 10px 24px;
        border-radius: 20px;
        border: none;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: opacity 0.15s;
      }

      .action-btn:hover {
        opacity: 0.85;
      }

      .action-btn litgui-icon {
        --mdc-icon-size: 20px;
      }

      .action-btn.primary {
        background: var(--primary-color, #03a9f4);
        color: #fff;
      }

      .action-btn.secondary {
        background: var(--divider-color, rgba(255, 255, 255, 0.12));
        color: var(--primary-text-color);
      }

      /* ── Track list ──────────────────────── */
      .track-list {
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
        border-radius: 8px;
        overflow: hidden;
      }

      .track-list-header {
        display: grid;
        grid-template-columns: 40px 1fr 1fr 0.8fr auto 60px 32px;
        align-items: center;
        height: 36px;
        padding: 0 12px;
        gap: 8px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--secondary-text-color);
        border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
        background: var(--card-background-color, #1e1e1e);
      }

      .track-list-header .hdr-duration {
        text-align: right;
      }

      /* ── Story (About this album) ────────── */
      .section {
        margin-top: var(--volumio-space-xl, 32px);
      }

      .section-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-text-color);
        margin-bottom: var(--volumio-space-md, 16px);
      }

      .story-text {
        font-size: 14px;
        line-height: 1.6;
        color: var(--primary-text-color);
        white-space: pre-wrap;
      }

      .story-toggle {
        margin-top: var(--volumio-space-sm, 8px);
        background: none;
        border: none;
        padding: 0;
        font-size: 13px;
        font-weight: 500;
        color: var(--primary-color, #03a9f4);
        cursor: pointer;
      }

      .story-toggle:hover {
        text-decoration: underline;
      }

      /* ── Credits ──────────────────────────── */
      .credits-list {
        display: flex;
        flex-direction: column;
        gap: var(--volumio-space-sm, 8px);
      }

      .credit-row {
        display: grid;
        grid-template-columns: minmax(140px, 30%) 1fr;
        gap: var(--volumio-space-md, 16px);
        font-size: 14px;
        line-height: 1.5;
      }

      .credit-key {
        color: var(--secondary-text-color);
        text-transform: capitalize;
      }

      .credit-values {
        color: var(--primary-text-color);
      }

      .credit-name {
        cursor: pointer;
        transition: color 0.15s;
      }

      .credit-name:hover {
        color: var(--primary-color, #03a9f4);
        text-decoration: underline;
      }

      .credits-toggle {
        margin-top: var(--volumio-space-sm, 8px);
        background: none;
        border: none;
        padding: 0;
        font-size: 13px;
        font-weight: 500;
        color: var(--primary-color, #03a9f4);
        cursor: pointer;
      }

      .credits-toggle:hover {
        text-decoration: underline;
      }

      /* ── Section skeletons ────────────────── */
      .skeleton-bar.w-full,
      .skeleton-bar.w-90,
      .skeleton-bar.w-75,
      .skeleton-bar.w-60 {
        height: 14px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
        margin-bottom: 8px;
      }

      .skeleton-bar.w-full { width: 100%; }
      .skeleton-bar.w-90 { width: 90%; }
      .skeleton-bar.w-75 { width: 75%; }
      .skeleton-bar.w-60 { width: 60%; }

      .skeleton-credit-row {
        display: grid;
        grid-template-columns: minmax(140px, 30%) 1fr;
        gap: var(--volumio-space-md, 16px);
        margin-bottom: 8px;
      }

      .skeleton-credit-key,
      .skeleton-credit-values {
        height: 14px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-credit-key { width: 60%; }
      .skeleton-credit-values { width: 80%; }

      @media (max-width: 768px) {
        .credit-row,
        .skeleton-credit-row {
          grid-template-columns: 1fr;
          gap: 2px;
        }
      }

      /* ── Loading skeleton ─────────────────── */
      @keyframes shimmer {
        0% { opacity: 0.3; }
        50% { opacity: 0.15; }
        100% { opacity: 0.3; }
      }

      .skeleton-header {
        display: flex;
        gap: var(--volumio-space-lg, 24px);
        margin-bottom: var(--volumio-space-xl, 32px);
      }

      .skeleton-art {
        width: 250px;
        height: 250px;
        border-radius: 6px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
        flex-shrink: 0;
      }

      .skeleton-meta {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 8px;
      }

      .skeleton-bar {
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-bar.title { width: 60%; height: 28px; }
      .skeleton-bar.artist { width: 30%; height: 16px; }
      .skeleton-bar.detail { width: 45%; height: 14px; }

      .skeleton-tracks {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .skeleton-track {
        height: 48px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      /* ── Responsive ──────────────────────── */
      @media (max-width: 768px) {
        .album-header {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .album-art-container {
          width: 200px;
          height: 200px;
        }

        .album-meta {
          align-items: center;
        }

        .album-actions {
          justify-content: center;
        }

        .track-list-header {
          grid-template-columns: 40px 1fr 0.8fr 60px 32px;
        }

        .track-list-header .hdr-album,
        .track-list-header .hdr-quality {
          display: none;
        }
      }
    `}constructor(){super(),this.albumTitle="",this.albumArtist="",this.albumArt="",this.albumUri="",this.albumService="",this.tracks=[],this.loading=!1,this.currentUri="",this.quality=null,this.volumioUrl="",this.story=null,this.credits=[],this.storyLoading=!1,this.creditsLoading=!1,this._storyExpanded=!1,this._creditsExpanded=!1}updated(t){(t.has("albumTitle")||t.has("albumArtist")||t.has("story")||t.has("credits"))&&(this._storyExpanded=!1,this._creditsExpanded=!1)}render(){if(this.loading)return this._renderSkeleton();const t=this.tracks.length,e=this.tracks.reduce((t,e)=>t+(e.duration||0),0);return N`
      <div class="album-header">
        <div class="album-art-container">
          ${this.albumArt?N`<img src="${xt(this.albumArt,this.volumioUrl,this.configEntryId)}" alt="${this.albumTitle}" @error=${this._onArtError} />`:N`<div class="album-art-placeholder">
                <litgui-icon icon="mdi:album"></litgui-icon>
              </div>`}
        </div>
        <div class="album-meta">
          <span class="meta-type">Album</span>
          <div class="album-name">${this.albumTitle||"Unknown Album"}</div>
          ${this.albumArtist?N`<span class="album-artist-link" @click=${this._goToArtist}>
                ${this.albumArtist}
              </span>`:""}
          <div class="meta-details">
            ${t>0?N`<span class="detail">${t} track${1!==t?"s":""}</span>`:""}
            ${t>0&&e>0?N`<span class="sep">·</span>`:""}
            ${e>0?N`<span class="detail">${_t(e)}</span>`:""}
            ${this.albumService?N`
              <span class="sep">·</span>
              <volumio-source-badge .source=${this.albumService}></volumio-source-badge>
            `:""}
          </div>
          ${this.quality&&"unknown"!==this.quality.tier?N`
            <div style="margin-top: 4px">
              <volumio-quality-badge .quality=${this.quality}></volumio-quality-badge>
            </div>
          `:""}
          <div class="album-actions">
            <button class="action-btn primary" @click=${this._playAlbum}>
              <litgui-icon icon="mdi:play"></litgui-icon> Play
            </button>
            <button class="action-btn secondary" @click=${this._addToQueue}>
              <litgui-icon icon="mdi:playlist-plus"></litgui-icon> Add to Queue
            </button>
            <button class="action-btn secondary" @click=${this._onMoreClick}>
              <litgui-icon icon="mdi:dots-horizontal"></litgui-icon>
            </button>
          </div>
        </div>
      </div>

      ${t>0?N`
        <div class="track-list">
          <div class="track-list-header">
            <span>#</span>
            <span>Title</span>
            <span>Artist</span>
            <span class="hdr-album">Album</span>
            <span class="hdr-quality">Quality</span>
            <span class="hdr-duration">Time</span>
            <span></span>
          </div>
          ${this.tracks.map((t,e)=>{const i=xt(t.albumart||this.albumArt,this.volumioUrl,this.configEntryId),s=bt(t);return N`
              <volumio-track-card
                .index=${e+1}
                title="${t.title||t.name||""}"
                artist="${t.artist||this.albumArtist||""}"
                album="${t.album||this.albumTitle||""}"
                .duration=${t.duration||0}
                uri="${t.uri||""}"
                albumart="${i}"
                service="${t.service||this.albumService||""}"
                type="${t.type||"song"}"
                .quality=${s}
                ?is-playing=${this.currentUri&&t.uri===this.currentUri}
                @volumio-track-click=${this._onTrackClick}
              ></volumio-track-card>
            `})}
        </div>
      `:N`
        <div style="text-align: center; padding: 32px; color: var(--secondary-text-color);">
          No tracks found
        </div>
      `}

      ${this._renderStorySection()}
      ${this._renderCreditsSection()}
    `}_renderStorySection(){if(this.storyLoading)return N`
        <div class="section" aria-busy="true" aria-label="Loading album story">
          <div class="section-title">About this album</div>
          <div class="skeleton-bar w-full"></div>
          <div class="skeleton-bar w-90"></div>
          <div class="skeleton-bar w-75"></div>
        </div>
      `;if(!this.story)return"";const t=this.story.split(/\s+/),e=t.length>200&&!this._storyExpanded?t.slice(0,200).join(" ")+"…":this.story;return N`
      <div class="section">
        <div class="section-title">About this album</div>
        <div class="story-text">${e}</div>
        ${t.length>200?N`
            <button class="story-toggle" @click=${this._toggleStory}>
              ${this._storyExpanded?"Show less":"Read more"}
            </button>
          `:""}
      </div>
    `}_renderCreditsSection(){if(this.creditsLoading)return N`
        <div class="section" aria-busy="true" aria-label="Loading album credits">
          <div class="section-title">Credits</div>
          ${Array(5).fill(0).map(()=>N`
            <div class="skeleton-credit-row">
              <div class="skeleton-credit-key"></div>
              <div class="skeleton-credit-values"></div>
            </div>
          `)}
        </div>
      `;if(!this.credits||0===this.credits.length)return"";const t=this._creditsExpanded||this.credits.length<=6?this.credits:this.credits.slice(0,6);return N`
      <div class="section">
        <div class="section-title">Credits</div>
        <div class="credits-list">
          ${t.map(t=>N`
            <div class="credit-row">
              <div class="credit-key">${t.key||""}</div>
              <div class="credit-values">
                ${(t.values||[]).map((e,i)=>N`<span
                  class="credit-name"
                  role="button"
                  tabindex="0"
                  @click=${()=>this._onCreditClick(e)}
                  @keydown=${t=>this._onCreditKeydown(t,e)}
                >${e.name||""}</span>${i<(t.values||[]).length-1?", ":""}`)}
              </div>
            </div>
          `)}
        </div>
        ${this.credits.length>6?N`
            <button class="credits-toggle" @click=${this._toggleCredits}>
              ${this._creditsExpanded?"Show fewer credits":`Show all ${this.credits.length} credits`}
            </button>
          `:""}
      </div>
    `}_toggleStory(){this._storyExpanded=!this._storyExpanded}_toggleCredits(){this._creditsExpanded=!this._creditsExpanded}_onCreditClick(t){const e=t?.name||"";e&&this.dispatchEvent(new CustomEvent("volumio-similar-artist-click",{detail:{artist:e,uri:`globalUriArtist/${e}`,albumart:""},bubbles:!0,composed:!0}))}_onCreditKeydown(t,e){"Enter"!==t.key&&" "!==t.key||(t.preventDefault(),this._onCreditClick(e))}_renderSkeleton(){return N`
      <div aria-busy="true" aria-label="Loading album">
        <div class="skeleton-header">
          <div class="skeleton-art"></div>
          <div class="skeleton-meta">
            <div class="skeleton-bar title"></div>
            <div class="skeleton-bar artist"></div>
            <div class="skeleton-bar detail"></div>
          </div>
        </div>
        <div class="skeleton-tracks">
          ${Array(8).fill(0).map(()=>N`<div class="skeleton-track"></div>`)}
        </div>
      </div>
    `}_playAlbum(){this.dispatchEvent(new CustomEvent("volumio-album-play",{detail:{uri:this.albumUri},bubbles:!0,composed:!0}))}_addToQueue(){this.dispatchEvent(new CustomEvent("volumio-album-add-queue",{detail:{uri:this.albumUri},bubbles:!0,composed:!0}))}_goToArtist(){this.dispatchEvent(new CustomEvent("volumio-navigate",{detail:{view:"artist-detail",artist:this.albumArtist},bubbles:!0,composed:!0}))}_onTrackClick(t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("volumio-track-click",{detail:t.detail,bubbles:!0,composed:!0}))}_onMoreClick(t){t.stopPropagation();const e=t.currentTarget.getBoundingClientRect();this.dispatchEvent(new CustomEvent("volumio-context-menu",{detail:{uri:this.albumUri,title:this.albumTitle,artist:this.albumArtist,albumart:this.albumArt,service:this.albumService,type:"album",x:e.right,y:e.bottom,context:"album"},bubbles:!0,composed:!0}))}_onArtError(t){const e=t.target.parentElement;t.target.remove(),e.innerHTML='<div class="album-art-placeholder"><litgui-icon icon="mdi:album"></litgui-icon></div>'}});customElements.define("volumio-artist-detail",class extends rt{static get properties(){return{artistName:{type:String,attribute:"artist-name"},items:{type:Array},loading:{type:Boolean},volumioUrl:{type:String,attribute:"volumio-url"},configEntryId:{type:String,attribute:"config-entry-id"},bio:{type:String},similarArtists:{type:Array,attribute:!1},bioLoading:{type:Boolean,attribute:"bio-loading"},similarLoading:{type:Boolean,attribute:"similar-loading"},_bioExpanded:{type:Boolean,state:!0}}}static get styles(){return o`
      :host {
        display: block;
        padding: var(--volumio-space-lg, 24px);
      }

      .artist-header {
        margin-bottom: var(--volumio-space-xl, 32px);
      }

      .artist-name {
        font-size: 28px;
        font-weight: 700;
        color: var(--primary-text-color);
        line-height: 1.2;
      }

      .section {
        margin-bottom: var(--volumio-space-xl, 32px);
      }

      .section-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-text-color);
        margin-bottom: var(--volumio-space-md, 16px);
      }

      .albums-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--volumio-space-md, 16px);
      }

      /* ── Bio ─────────────────────────────── */
      .bio-text {
        font-size: 14px;
        line-height: 1.6;
        color: var(--primary-text-color);
        white-space: pre-wrap;
      }

      .bio-toggle {
        margin-top: var(--volumio-space-sm, 8px);
        background: none;
        border: none;
        padding: 0;
        font-size: 13px;
        font-weight: 500;
        color: var(--primary-color, #03a9f4);
        cursor: pointer;
      }

      .bio-toggle:hover {
        text-decoration: underline;
      }

      /* ── Similar artists ─────────────────── */
      .similar-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: var(--volumio-space-md, 16px);
      }

      .similar-card {
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--volumio-space-sm, 8px);
        padding: var(--volumio-space-sm, 8px);
        border-radius: 8px;
        transition: background 0.15s;
      }

      .similar-card:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.06));
      }

      .similar-art {
        width: 100%;
        aspect-ratio: 1;
        border-radius: 50%;
        overflow: hidden;
        background: var(--card-background-color, #2a2a2a);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .similar-name {
        font-size: 14px;
        font-weight: 500;
        color: var(--primary-text-color);
        line-height: 1.3;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        width: 100%;
      }

      /* ── Loading skeleton ─────────────────── */
      @keyframes shimmer {
        0% { opacity: 0.3; }
        50% { opacity: 0.15; }
        100% { opacity: 0.3; }
      }

      .skeleton-name {
        width: 40%;
        height: 28px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
        margin-bottom: var(--volumio-space-xl, 32px);
      }

      .skeleton-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--volumio-space-md, 16px);
      }

      .skeleton-card {
        aspect-ratio: 1;
        border-radius: 6px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-bar {
        height: 14px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
        margin-bottom: 8px;
      }

      .skeleton-bar.w-full { width: 100%; }
      .skeleton-bar.w-90 { width: 90%; }
      .skeleton-bar.w-75 { width: 75%; }
      .skeleton-bar.w-60 { width: 60%; }

      .skeleton-similar-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: var(--volumio-space-md, 16px);
      }

      .skeleton-similar-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--volumio-space-sm, 8px);
      }

      .skeleton-similar-art {
        width: 100%;
        aspect-ratio: 1;
        border-radius: 50%;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-similar-name {
        width: 70%;
        height: 14px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .empty-state {
        text-align: center;
        padding: var(--volumio-space-xl, 32px);
        color: var(--secondary-text-color);
        font-size: 14px;
      }
    `}constructor(){super(),this.artistName="",this.items=[],this.loading=!1,this.volumioUrl="",this.bio=null,this.similarArtists=[],this.bioLoading=!1,this.similarLoading=!1,this._bioExpanded=!1}updated(t){(t.has("artistName")||t.has("bio"))&&(this._bioExpanded=!1)}render(){return this.loading?this._renderSkeleton():N`
      <div class="artist-header">
        <div class="artist-name">${this.artistName||"Unknown Artist"}</div>
      </div>

      <div class="section">
        <div class="section-title">Albums</div>
        ${this.items&&this.items.length>0?N`
            <div class="albums-grid">
              ${this.items.map(t=>{const e=xt(t.albumart,this.volumioUrl,this.configEntryId);return N`
                  <volumio-album-card
                    title="${t.title||t.name||""}"
                    artist="${t.artist||this.artistName||""}"
                    albumart="${e}"
                    uri="${t.uri||""}"
                    type="album"
                    service="${t.service||""}"
                    @volumio-card-click=${this._onCardClick}
                    @volumio-card-play=${this._onCardPlay}
                  ></volumio-album-card>
                `})}
            </div>
          `:N`<div class="empty-state">No albums found</div>`}
      </div>

      ${this._renderBioSection()}
      ${this._renderSimilarSection()}
    `}_renderBioSection(){if(this.bioLoading)return N`
        <div class="section" aria-busy="true" aria-label="Loading artist bio">
          <div class="section-title">About</div>
          <div class="skeleton-bar w-full"></div>
          <div class="skeleton-bar w-90"></div>
          <div class="skeleton-bar w-75"></div>
        </div>
      `;if(!this.bio)return"";const t=this.bio.split(/\s+/),e=t.length>200&&!this._bioExpanded?t.slice(0,200).join(" ")+"…":this.bio;return N`
      <div class="section">
        <div class="section-title">About</div>
        <div class="bio-text">${e}</div>
        ${t.length>200?N`
            <button class="bio-toggle" @click=${this._toggleBio}>
              ${this._bioExpanded?"Show less":"Read more"}
            </button>
          `:""}
      </div>
    `}_renderSimilarSection(){return this.similarLoading?N`
        <div class="section" aria-busy="true" aria-label="Loading similar artists">
          <div class="section-title">Similar Artists</div>
          <div class="skeleton-similar-grid">
            ${Array(6).fill(0).map(()=>N`
              <div class="skeleton-similar-card">
                <div class="skeleton-similar-art"></div>
                <div class="skeleton-similar-name"></div>
              </div>
            `)}
          </div>
        </div>
      `:this.similarArtists&&0!==this.similarArtists.length?N`
      <div class="section">
        <div class="section-title">Similar Artists</div>
        <div class="similar-grid">
          ${this.similarArtists.map(t=>{const e=xt(t.albumart,this.volumioUrl,this.configEntryId);return N`
              <div
                class="similar-card"
                role="button"
                tabindex="0"
                @click=${()=>this._onSimilarClick(t)}
                @keydown=${e=>this._onSimilarKeydown(e,t)}
              >
                <div class="similar-art">
                  <litgui-art
                    src="${e}"
                    icon="mdi:account-music"
                    alt="${t.artist||""}"
                  ></litgui-art>
                </div>
                <div class="similar-name">${t.artist||"Unknown"}</div>
              </div>
            `})}
        </div>
      </div>
    `:""}_renderSkeleton(){return N`
      <div aria-busy="true" aria-label="Loading artist">
        <div class="skeleton-name"></div>
        <div class="skeleton-grid">
          ${Array(6).fill(0).map(()=>N`<div class="skeleton-card"></div>`)}
        </div>
      </div>
    `}_toggleBio(){this._bioExpanded=!this._bioExpanded}_onSimilarClick(t){this.dispatchEvent(new CustomEvent("volumio-similar-artist-click",{detail:{artist:t.artist||"",uri:t.uri||"",albumart:t.albumart||""},bubbles:!0,composed:!0}))}_onSimilarKeydown(t,e){"Enter"!==t.key&&" "!==t.key||(t.preventDefault(),this._onSimilarClick(e))}_onCardClick(t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("volumio-card-click",{detail:t.detail,bubbles:!0,composed:!0}))}_onCardPlay(t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("volumio-card-play",{detail:t.detail,bubbles:!0,composed:!0}))}});customElements.define("volumio-search-results",class extends rt{static get properties(){return{results:{type:Object},loading:{type:Boolean},query:{type:String},volumioUrl:{type:String,attribute:"volumio-url"},configEntryId:{type:String,attribute:"config-entry-id"},currentUri:{type:String,attribute:"current-uri"},_expandedSections:{type:Object,state:!0}}}static get styles(){return o`
      :host {
        display: block;
        padding: var(--volumio-space-lg, 24px);
      }

      .results-header {
        font-size: 14px;
        color: var(--secondary-text-color);
        margin-bottom: var(--volumio-space-lg, 24px);
      }

      .results-header strong {
        color: var(--primary-text-color);
      }

      /* ── Source group ─────────────────────── */
      .source-group {
        margin-bottom: var(--volumio-space-xl, 32px);
      }

      .source-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--volumio-space-sm, 8px);
        cursor: pointer;
      }

      .source-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-text-color);
      }

      .source-count {
        font-size: 12px;
        color: var(--secondary-text-color);
        padding: 2px 8px;
        border-radius: 10px;
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }

      .collapse-icon {
        --mdc-icon-size: 20px;
        color: var(--secondary-text-color);
        transition: transform 0.2s;
      }

      .collapse-icon.collapsed {
        transform: rotate(-90deg);
      }

      /* ── Type subsection ──────────────────── */
      .type-section {
        margin-bottom: var(--volumio-space-md, 16px);
      }

      .type-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: var(--volumio-space-sm, 8px);
      }

      .items-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: var(--volumio-space-sm, 8px);
      }

      .items-list {
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
        border-radius: 8px;
        overflow: hidden;
      }

      .artist-link {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        border-radius: 20px;
        background: var(--card-background-color, #1e1e1e);
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
        color: var(--primary-text-color);
        font-size: 14px;
        cursor: pointer;
        transition: background 0.15s;
        margin: 0 8px 8px 0;
      }

      .artist-link:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }

      .artist-link litgui-icon {
        --mdc-icon-size: 18px;
        color: var(--secondary-text-color);
      }

      .show-all-btn {
        border: none;
        background: none;
        color: var(--primary-color, #03a9f4);
        font-size: 13px;
        cursor: pointer;
        padding: 4px 0;
        margin-top: var(--volumio-space-xs, 4px);
      }

      .show-all-btn:hover {
        text-decoration: underline;
      }

      /* ── Loading / empty ──────────────────── */
      @keyframes shimmer {
        0% { opacity: 0.3; }
        50% { opacity: 0.15; }
        100% { opacity: 0.3; }
      }

      .skeleton-results {
        display: flex;
        flex-direction: column;
        gap: var(--volumio-space-lg, 24px);
      }

      .skeleton-section-title {
        width: 30%;
        height: 18px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: var(--volumio-space-sm, 8px);
      }

      .skeleton-card {
        aspect-ratio: 1;
        border-radius: 6px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-row {
        height: 48px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
        margin-bottom: 4px;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--volumio-space-xxl, 48px);
        text-align: center;
        gap: var(--volumio-space-md, 16px);
      }

      .empty-state litgui-icon {
        --mdc-icon-size: 48px;
        color: var(--secondary-text-color);
        opacity: 0.3;
      }

      .empty-state .message {
        font-size: 16px;
        color: var(--secondary-text-color);
      }
    `}constructor(){super(),this.results=null,this.loading=!1,this.query="",this.volumioUrl="",this.currentUri="",this._expandedSections={}}render(){if(this.loading)return this._renderSkeleton();const t=this._parseResults();if(!t||0===t.length)return this.query?N`
        <div class="empty-state">
          <litgui-icon icon="mdi:magnify-close"></litgui-icon>
          <div class="message">No results found for "${this.query}"</div>
        </div>
      `:N``;const e=t.reduce((t,e)=>t+e.sections.reduce((t,e)=>t+e.items.length,0),0);return N`
      <div class="results-header">
        Found <strong>${e}</strong> result${1!==e?"s":""} for "<strong>${this.query}</strong>"
      </div>

      ${t.map(t=>this._renderSourceGroup(t))}
    `}_parseResults(){if(!this.results)return[];const t=this.results.navigation||this.results,e=t?.lists||[];if(0===e.length)return[];const i=new Map;for(const t of e){if(!t.items||0===t.items.length)continue;const{source:e,type:s}=this._parseListTitle(t.title||"");i.has(e)||i.set(e,new Map);const a=i.get(e);a.has(s)||a.set(s,[]),a.get(s).push(...t.items)}const s=[];for(const[t,e]of i){const i=[];for(const[t,s]of e)i.push({type:t,items:s});s.push({source:t,sections:i})}return s}_parseListTitle(t){if(!t)return{source:"Other",type:"Results"};const e=["QOBUZ","TIDAL","SPOTIFY","YOUTUBE","PANDORA"];for(const i of e)if(t.startsWith(i+" ")){const e=t.substring(i.length+1).trim();return{source:this._capitalizeSource(i),type:e||"Results"}}const i=t.match(/^Found\s+\d+\s+(\w+)/i);if(i){let t=i[1];return t.endsWith("s")||(t+="s"),{source:"Local",type:t}}return{source:"Other",type:t}}_capitalizeSource(t){return t.charAt(0).toUpperCase()+t.slice(1).toLowerCase()}_renderSourceGroup(t){const e=t.source,i=t.sections.reduce((t,e)=>t+e.items.length,0),s=!1===this._expandedSections[e];return N`
      <div class="source-group">
        <div class="source-header" @click=${()=>this._toggleSection(e)}>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="source-title">${t.source}</span>
            <span class="source-count">${i}</span>
          </div>
          <litgui-icon
            class="collapse-icon ${s?"collapsed":""}"
            icon="mdi:chevron-down"
          ></litgui-icon>
        </div>
        ${s?"":t.sections.map(t=>this._renderTypeSection(t,e))}
      </div>
    `}_renderTypeSection(t,e){const i=`${e}:${t.type}`,s=!0===this._expandedSections[i],a=t.type.toLowerCase(),o=a.includes("album"),r=a.includes("track")||a.includes("song"),n=a.includes("artist");let l;l=o?4:r||n?3:4;const c=s?t.items:t.items.slice(0,l),d=t.items.length>l&&!s;return N`
      <div class="type-section">
        <div class="type-title">${t.type}</div>

        ${n?this._renderArtistItems(c):r?this._renderTrackItems(c):this._renderGridItems(c,o?"album":null)}

        ${d?N`
          <button class="show-all-btn" @click=${()=>this._expandSection(i)}>
            Show all ${t.items.length} →
          </button>
        `:""}
      </div>
    `}_renderGridItems(t,e){return N`
      <div class="items-grid">
        ${t.map(t=>{const i=xt(t.albumart,this.volumioUrl,this.configEntryId);return N`
            <volumio-album-card
              title="${t.title||t.name||""}"
              artist="${t.artist||""}"
              albumart="${i}"
              uri="${t.uri||""}"
              type="${e||t.type||"album"}"
              service="${t.service||""}"
              @volumio-card-click=${this._onCardClick}
              @volumio-card-play=${this._onCardPlay}
            ></volumio-album-card>
          `})}
      </div>
    `}_renderTrackItems(t){return N`
      <div class="items-list">
        ${t.map((t,e)=>{const i=xt(t.albumart,this.volumioUrl,this.configEntryId);return N`
            <volumio-track-card
              .index=${e+1}
              title="${t.title||t.name||""}"
              artist="${t.artist||""}"
              album="${t.album||""}"
              .duration=${t.duration||0}
              uri="${t.uri||""}"
              albumart="${i}"
              service="${t.service||""}"
              type="${t.type||"song"}"
              ?is-playing=${this.currentUri&&t.uri===this.currentUri}
              @volumio-track-click=${this._onTrackClick}
            ></volumio-track-card>
          `})}
      </div>
    `}_renderArtistItems(t){return N`
      <div style="display: flex; flex-wrap: wrap;">
        ${t.map(t=>N`
          <span
            class="artist-link"
            @click=${()=>this._onArtistClick(t)}
          >
            <litgui-icon icon="mdi:account-music"></litgui-icon>
            ${t.title||t.name||"Unknown"}
          </span>
        `)}
      </div>
    `}_renderSkeleton(){return N`
      <div class="skeleton-results" aria-busy="true" aria-label="Searching">
        <div class="skeleton-section-title"></div>
        <div class="skeleton-grid">
          ${Array(4).fill(0).map(()=>N`<div class="skeleton-card"></div>`)}
        </div>
        <div class="skeleton-section-title"></div>
        ${Array(3).fill(0).map(()=>N`<div class="skeleton-row"></div>`)}
      </div>
    `}_toggleSection(t){this._expandedSections={...this._expandedSections,[t]:!1===this._expandedSections[t]&&void 0}}_expandSection(t){this._expandedSections={...this._expandedSections,[t]:!0}}_onCardClick(t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("volumio-card-click",{detail:t.detail,bubbles:!0,composed:!0}))}_onCardPlay(t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("volumio-card-play",{detail:t.detail,bubbles:!0,composed:!0}))}_onTrackClick(t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("volumio-track-click",{detail:t.detail,bubbles:!0,composed:!0}))}_onArtistClick(t){this.dispatchEvent(new CustomEvent("volumio-card-click",{detail:{uri:t.uri||"",title:t.title||t.name||"",artist:t.title||t.name||"",albumart:t.albumart||"",type:"artist",service:t.service||""},bubbles:!0,composed:!0}))}});customElements.define("volumio-breadcrumb-bar",class extends rt{static get properties(){return{trail:{type:Array}}}static get styles(){return o`
      :host {
        display: block;
      }

      .breadcrumb {
        display: flex;
        align-items: center;
        height: var(--volumio-breadcrumb-height, 32px);
        padding: 0 var(--volumio-space-md, 16px);
        background: var(--card-background-color, #1e1e1e);
        border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
        font-size: 13px;
        color: var(--secondary-text-color);
        gap: 2px;
        overflow: hidden;
      }

      .segment {
        cursor: pointer;
        color: var(--secondary-text-color);
        white-space: nowrap;
        padding: 2px 4px;
        border-radius: 4px;
        transition: color 0.15s, background 0.15s;
      }

      .segment:hover {
        color: var(--primary-text-color);
        background: var(--divider-color, rgba(255, 255, 255, 0.06));
      }

      .segment.current {
        color: var(--primary-text-color);
        font-weight: 600;
        cursor: default;
      }

      .segment.current:hover {
        background: none;
      }

      .sep {
        color: var(--secondary-text-color);
        opacity: 0.4;
        flex-shrink: 0;
        display: flex;
        align-items: center;
      }

      .sep litgui-icon {
        --mdc-icon-size: 14px;
      }

      .ellipsis {
        color: var(--secondary-text-color);
        opacity: 0.5;
        padding: 0 2px;
      }
    `}constructor(){super(),this.trail=[]}render(){if(!this.trail||0===this.trail.length)return N``;const t=this._getDisplaySegments();return N`
      <div class="breadcrumb">
        ${t.map((e,i)=>{const s=i===t.length-1;return N`
            ${i>0?N`<span class="sep"><litgui-icon icon="mdi:chevron-right"></litgui-icon></span>`:""}
            ${e.ellipsis?N`<span class="ellipsis">...</span>`:N`
                <span
                  class="segment ${s?"current":""}"
                  @click=${()=>!s&&this._onClick(e.index)}
                  title="${e.title}"
                >${e.title}</span>
              `}
          `})}
      </div>
    `}_getDisplaySegments(){const t=this.trail;return t.length<=5?t.map((t,e)=>({...t,index:e})):[{...t[0],index:0},{ellipsis:!0},...t.slice(-3).map((e,i)=>({...e,index:t.length-3+i}))]}_onClick(t){const e=this.trail[t];e&&this.dispatchEvent(new CustomEvent("volumio-breadcrumb-click",{detail:{index:t,uri:e.uri,title:e.title},bubbles:!0,composed:!0}))}});customElements.define("volumio-context-menu",class extends rt{static get properties(){return{open:{type:Boolean,reflect:!0},x:{type:Number},y:{type:Number},items:{type:Array},submenuItems:{type:Array},_showSubmenu:{type:Boolean,state:!0},_posStyle:{type:String,state:!0}}}static get styles(){return o`
      :host {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 9999;
        pointer-events: none;
        display: none;
      }

      :host([open]) {
        display: block;
        pointer-events: auto;
      }

      .backdrop {
        position: absolute;
        inset: 0;
      }

      .menu {
        position: absolute;
        width: 240px;
        background: var(--card-background-color, #2a2a2a);
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        padding: 4px 0;
        opacity: 0;
        transform: scale(0.95);
        transition: opacity 100ms ease-out, transform 100ms ease-out;
        overflow: hidden;
        max-height: 80vh;
        overflow-y: auto;
      }

      :host([open]) .menu {
        opacity: 1;
        transform: scale(1);
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        cursor: pointer;
        font-size: 14px;
        color: var(--primary-text-color);
        transition: background 0.1s;
        user-select: none;
      }

      .menu-item:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }

      .menu-item.disabled {
        opacity: 0.4;
        pointer-events: none;
      }

      .menu-item litgui-icon {
        --mdc-icon-size: 18px;
        color: var(--secondary-text-color);
        flex-shrink: 0;
      }

      .menu-item .label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .menu-item .arrow {
        --mdc-icon-size: 14px;
        color: var(--secondary-text-color);
      }

      .separator {
        height: 1px;
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
        margin: 4px 0;
      }

      /* ── Submenu ──────────────────────────── */
      .submenu-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        color: var(--secondary-text-color);
        border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
      }

      .submenu-header litgui-icon {
        --mdc-icon-size: 16px;
        cursor: pointer;
      }

      .submenu-header litgui-icon:hover {
        color: var(--primary-text-color);
      }

      .submenu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 16px;
        cursor: pointer;
        font-size: 13px;
        color: var(--primary-text-color);
        transition: background 0.1s;
      }

      .submenu-item:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
      }

      .submenu-item litgui-icon {
        --mdc-icon-size: 16px;
        color: var(--secondary-text-color);
      }

      .submenu-item.create-new {
        color: var(--primary-color, #03a9f4);
        border-top: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
        margin-top: 4px;
      }
    `}constructor(){super(),this.open=!1,this.x=0,this.y=0,this.items=[],this.submenuItems=[],this._showSubmenu=!1,this._posStyle="",this._onKeyDown=this._onKeyDown.bind(this)}updated(t){t.has("open")&&(this.open?(this._showSubmenu=!1,this._computePosition(),document.addEventListener("keydown",this._onKeyDown)):document.removeEventListener("keydown",this._onKeyDown)),(t.has("x")||t.has("y"))&&this.open&&this._computePosition()}disconnectedCallback(){super.disconnectedCallback(),document.removeEventListener("keydown",this._onKeyDown)}_computePosition(){const t=Math.min(40*(this.items?.length||0)+20,.8*window.innerHeight);let e=this.x,i=this.y;e+240>window.innerWidth-8&&(e=window.innerWidth-240-8),e<8&&(e=8),i+t>window.innerHeight-8&&(i=window.innerHeight-t-8),i<8&&(i=8),this._posStyle=`left:${e}px;top:${i}px`}render(){return N`
      <div class="backdrop" @click=${this._close} @contextmenu=${this._preventAndClose}></div>
      <div class="menu" style="${this._posStyle}">
        ${this._showSubmenu?this._renderSubmenu():this._renderMainMenu()}
      </div>
    `}_renderMainMenu(){return(this.items||[]).map(t=>t.separator?N`<div class="separator"></div>`:N`
        <div
          class="menu-item ${t.disabled?"disabled":""}"
          @click=${()=>this._onAction(t)}
        >
          <litgui-icon icon="${t.icon}"></litgui-icon>
          <span class="label">${t.label}</span>
          ${t.submenu?N`<litgui-icon class="arrow" icon="mdi:chevron-right"></litgui-icon>`:""}
        </div>
      `)}_renderSubmenu(){return N`
      <div class="submenu-header">
        <litgui-icon icon="mdi:arrow-left" @click=${()=>{this._showSubmenu=!1}}></litgui-icon>
        Add to Playlist
      </div>
      ${(this.submenuItems||[]).map(t=>N`
        <div class="submenu-item" @click=${()=>this._onSubmenuAction(t.key)}>
          <litgui-icon icon="mdi:playlist-music"></litgui-icon>
          <span class="label">${t.label}</span>
        </div>
      `)}
      <div class="submenu-item create-new" @click=${()=>this._onSubmenuAction("__new__")}>
        <litgui-icon icon="mdi:plus"></litgui-icon>
        <span class="label">New Playlist</span>
      </div>
    `}_onAction(t){t.disabled||(t.submenu?this._showSubmenu=!0:(this.dispatchEvent(new CustomEvent("volumio-context-action",{detail:{action:t.key},bubbles:!0,composed:!0})),this._close()))}_onSubmenuAction(t){this.dispatchEvent(new CustomEvent("volumio-context-action",{detail:{action:"add_to_playlist",playlist:t},bubbles:!0,composed:!0})),this._close()}_close(){this.open=!1,this.dispatchEvent(new CustomEvent("volumio-context-close",{bubbles:!0,composed:!0}))}_preventAndClose(t){t.preventDefault(),this._close()}_onKeyDown(t){"Escape"===t.key&&this._close()}});customElements.define("volumio-toast-notification",class extends rt{static get properties(){return{message:{type:String},open:{type:Boolean,reflect:!0},undoAction:{type:String,attribute:"undo-action"}}}static get styles(){return o`
      :host {
        position: fixed;
        bottom: 80px;  /* above player bar */
        left: 50%;
        transform: translateX(-50%);
        z-index: 9000;
        pointer-events: none;
        display: block;
      }

      .toast {
        max-width: 320px;
        min-width: 200px;
        padding: 10px 16px;
        background: rgba(30, 30, 30, 0.95);
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        gap: 12px;
        pointer-events: auto;
        opacity: 0;
        transform: translateY(20px);
        transition: opacity 200ms ease-out, transform 200ms ease-out;
      }

      :host([open]) .toast {
        opacity: 1;
        transform: translateY(0);
      }

      .toast-message {
        flex: 1;
        font-size: 13px;
        color: #eee;
        line-height: 1.3;
      }

      .toast-undo {
        font-size: 13px;
        font-weight: 600;
        color: var(--primary-color, #03a9f4);
        cursor: pointer;
        white-space: nowrap;
        padding: 2px 4px;
        border-radius: 4px;
        transition: background 0.1s;
      }

      .toast-undo:hover {
        background: rgba(255, 255, 255, 0.08);
      }
    `}constructor(){super(),this.message="",this.open=!1,this.undoAction=null,this._timer=null}updated(t){t.has("open")&&this.open&&this._startDismissTimer()}_startDismissTimer(){this._timer&&clearTimeout(this._timer),this._timer=setTimeout(()=>{this._dismiss()},3e3)}render(){return N`
      <div class="toast">
        <span class="toast-message">${this.message}</span>
        ${this.undoAction?N`<span class="toast-undo" @click=${this._onUndo}>Undo</span>`:""}
      </div>
    `}_onUndo(){this._timer&&(clearTimeout(this._timer),this._timer=null),this.dispatchEvent(new CustomEvent("volumio-toast-undo",{detail:{action:this.undoAction},bubbles:!0,composed:!0})),this._dismiss()}_dismiss(){this._timer&&(clearTimeout(this._timer),this._timer=null),this.open=!1,this.dispatchEvent(new CustomEvent("volumio-toast-dismiss",{bubbles:!0,composed:!0}))}show(t,e=null){this.message=t,this.undoAction=e,this.open=!0}});customElements.define("volumio-playlist-list",class extends rt{static get properties(){return{playlists:{type:Array},loading:{type:Boolean},_showCreateInput:{type:Boolean,state:!0},_createName:{type:String,state:!0}}}static get styles(){return o`
      :host {
        display: block;
        padding: var(--volumio-space-lg, 24px);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--volumio-space-lg, 24px);
      }

      .title {
        font-size: 24px;
        font-weight: 700;
        color: var(--primary-text-color);
      }

      .count {
        font-size: 14px;
        color: var(--secondary-text-color);
        margin-left: 12px;
      }

      .create-btn {
        padding: 8px 20px;
        border-radius: 20px;
        border: none;
        background: var(--primary-color, #03a9f4);
        color: #fff;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: opacity 0.15s;
      }

      .create-btn:hover {
        opacity: 0.85;
      }

      .create-btn litgui-icon {
        --mdc-icon-size: 18px;
      }

      /* ── Create input ──────────────── */
      .create-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: var(--volumio-space-md, 16px);
        padding: 8px 12px;
        background: var(--card-background-color, #1e1e1e);
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        border-radius: 8px;
      }

      .create-row input {
        flex: 1;
        border: none;
        background: transparent;
        color: var(--primary-text-color);
        font-size: 14px;
        outline: none;
        min-width: 0;
      }

      .create-row input::placeholder {
        color: var(--secondary-text-color, #888);
      }

      .create-row button {
        padding: 6px 16px;
        border-radius: 14px;
        border: none;
        font-size: 13px;
        cursor: pointer;
      }

      .create-row .save-btn {
        background: var(--primary-color, #03a9f4);
        color: #fff;
      }

      .create-row .cancel-btn {
        background: var(--divider-color, rgba(255, 255, 255, 0.12));
        color: var(--primary-text-color);
      }

      /* ── Playlist items ────────────── */
      .playlist-list {
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
        border-radius: 8px;
        overflow: hidden;
      }

      .playlist-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        cursor: pointer;
        transition: background 0.1s;
        border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.04));
      }

      .playlist-item:last-child {
        border-bottom: none;
      }

      .playlist-item:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.06));
      }

      .playlist-icon {
        width: 40px;
        height: 40px;
        border-radius: 4px;
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .playlist-icon litgui-icon {
        --mdc-icon-size: 20px;
        color: var(--secondary-text-color);
      }

      .playlist-name {
        flex: 1;
        font-size: 16px;
        font-weight: 500;
        color: var(--primary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .playlist-context {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: var(--secondary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        opacity: 0;
        transition: opacity 0.1s;
      }

      .playlist-item:hover .playlist-context {
        opacity: 1;
      }

      .playlist-context:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
        color: var(--primary-text-color);
      }

      .playlist-context litgui-icon {
        --mdc-icon-size: 18px;
      }

      /* ── Empty state ───────────────── */
      .empty-state {
        text-align: center;
        padding: 64px 24px;
        color: var(--secondary-text-color);
      }

      .empty-state litgui-icon {
        --mdc-icon-size: 48px;
        opacity: 0.3;
        margin-bottom: 16px;
      }

      .empty-state .empty-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-text-color);
        margin-bottom: 8px;
      }

      .empty-state .empty-desc {
        font-size: 14px;
        max-width: 360px;
        margin: 0 auto;
        line-height: 1.5;
      }

      /* ── Loading ───────────────────── */
      @keyframes shimmer {
        0% { opacity: 0.3; }
        50% { opacity: 0.15; }
        100% { opacity: 0.3; }
      }

      .skeleton-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
      }

      .skeleton-icon {
        width: 40px;
        height: 40px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-text {
        height: 16px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-text.wide { width: 45%; }
      .skeleton-text.medium { width: 30%; }
    `}constructor(){super(),this.playlists=[],this.loading=!1,this._showCreateInput=!1,this._createName=""}render(){return this.loading?this._renderSkeleton():N`
      <div class="header">
        <div>
          <span class="title">Playlists</span>
          ${this.playlists.length>0?N`<span class="count">${this.playlists.length} playlist${1!==this.playlists.length?"s":""}</span>`:""}
        </div>
        <button class="create-btn" @click=${this._onCreateClick}>
          <litgui-icon icon="mdi:plus"></litgui-icon> New Playlist
        </button>
      </div>

      ${this._showCreateInput?N`
        <div class="create-row">
          <input
            type="text"
            placeholder="Playlist name"
            .value=${this._createName}
            @input=${t=>{this._createName=t.target.value}}
            @keydown=${this._onCreateKeydown}
          />
          <button class="save-btn" @click=${this._onCreateConfirm}>Create</button>
          <button class="cancel-btn" @click=${()=>{this._showCreateInput=!1}}>Cancel</button>
        </div>
      `:""}

      ${0===this.playlists.length?N`
          <div class="empty-state">
            <litgui-icon icon="mdi:playlist-music-outline"></litgui-icon>
            <div class="empty-title">No playlists yet</div>
            <div class="empty-desc">Create one from the queue or while browsing.</div>
          </div>
        `:N`
          <div class="playlist-list">
            ${this.playlists.map(t=>N`
              <div
                class="playlist-item"
                @click=${()=>this._onSelect(t)}
                @contextmenu=${e=>this._onContextMenu(e,t)}
              >
                <div class="playlist-icon">
                  <litgui-icon icon="mdi:playlist-music"></litgui-icon>
                </div>
                <div class="playlist-name">${t.title}</div>
                <button
                  class="playlist-context"
                  @click=${e=>this._onDotsClick(e,t)}
                  title="More actions"
                >
                  <litgui-icon icon="mdi:dots-vertical"></litgui-icon>
                </button>
              </div>
            `)}
          </div>
        `}
    `}_renderSkeleton(){return N`
      <div class="header">
        <span class="title">Playlists</span>
      </div>
      <div class="playlist-list">
        ${Array(4).fill(0).map(()=>N`
          <div class="skeleton-item">
            <div class="skeleton-icon"></div>
            <div class="skeleton-text wide"></div>
          </div>
        `)}
      </div>
    `}_onSelect(t){this.dispatchEvent(new CustomEvent("volumio-playlist-select",{detail:{name:t.title,uri:t.uri},bubbles:!0,composed:!0}))}_onCreateClick(){this._showCreateInput=!0,this._createName="",this.updateComplete.then(()=>{const t=this.shadowRoot?.querySelector(".create-row input");t&&t.focus()})}_onCreateKeydown(t){"Enter"===t.key&&this._onCreateConfirm(),"Escape"===t.key&&(this._showCreateInput=!1)}_onCreateConfirm(){const t=this._createName.trim();t&&(this._showCreateInput=!1,this.dispatchEvent(new CustomEvent("volumio-playlist-create",{detail:{name:t},bubbles:!0,composed:!0})))}_onDotsClick(t,e){t.stopPropagation(),t.preventDefault();const i=t.currentTarget.getBoundingClientRect();this._fireContextMenu(i.right,i.bottom,e)}_onContextMenu(t,e){t.preventDefault(),t.stopPropagation(),this._fireContextMenu(t.clientX,t.clientY,e)}_fireContextMenu(t,e,i){this.dispatchEvent(new CustomEvent("volumio-context-menu",{detail:{title:i.title,uri:i.uri,service:i.service||"",type:"playlist",x:t,y:e,context:"playlist"},bubbles:!0,composed:!0}))}});customElements.define("volumio-playlist-detail",class extends rt{static get properties(){return{playlistName:{type:String,attribute:"playlist-name"},playlistUri:{type:String,attribute:"playlist-uri"},tracks:{type:Array},loading:{type:Boolean},currentUri:{type:String,attribute:"current-uri"},volumioUrl:{type:String,attribute:"volumio-url"},configEntryId:{type:String,attribute:"config-entry-id"},_confirmDelete:{type:Boolean,state:!0}}}static get styles(){return o`
      :host {
        display: block;
        padding: var(--volumio-space-lg, 24px);
      }

      /* ── Header ──────────────────────── */
      .playlist-header {
        display: flex;
        align-items: center;
        gap: var(--volumio-space-lg, 24px);
        margin-bottom: var(--volumio-space-xl, 32px);
      }

      .playlist-icon-box {
        width: 120px;
        height: 120px;
        border-radius: 8px;
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .playlist-icon-box litgui-icon {
        --mdc-icon-size: 48px;
        color: var(--secondary-text-color);
        opacity: 0.5;
      }

      .playlist-meta {
        display: flex;
        flex-direction: column;
        gap: var(--volumio-space-xs, 4px);
        min-width: 0;
      }

      .meta-type {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--secondary-text-color);
      }

      .playlist-title {
        font-size: 28px;
        font-weight: 700;
        color: var(--primary-text-color);
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .meta-details {
        display: flex;
        align-items: center;
        gap: var(--volumio-space-sm, 8px);
        flex-wrap: wrap;
        margin-top: var(--volumio-space-xs, 4px);
      }

      .meta-details .detail {
        font-size: 13px;
        color: var(--secondary-text-color);
      }

      .meta-details .sep {
        color: var(--secondary-text-color);
        opacity: 0.4;
      }

      .playlist-actions {
        display: flex;
        gap: var(--volumio-space-sm, 8px);
        margin-top: var(--volumio-space-md, 16px);
      }

      .action-btn {
        padding: 10px 24px;
        border-radius: 20px;
        border: none;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: opacity 0.15s;
      }

      .action-btn:hover {
        opacity: 0.85;
      }

      .action-btn litgui-icon {
        --mdc-icon-size: 20px;
      }

      .action-btn.primary {
        background: var(--primary-color, #03a9f4);
        color: #fff;
      }

      .action-btn.secondary {
        background: var(--divider-color, rgba(255, 255, 255, 0.12));
        color: var(--primary-text-color);
      }

      .action-btn.danger {
        background: transparent;
        color: var(--error-color, #ef5350);
        border: 1px solid var(--error-color, #ef5350);
      }

      /* ── Confirm bar ───────────────── */
      .confirm-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 10px 16px;
        background: var(--error-color, #ef5350);
        color: #fff;
        border-radius: 8px;
        margin-bottom: var(--volumio-space-md, 16px);
        font-size: 14px;
      }

      .confirm-bar button {
        padding: 4px 16px;
        border-radius: 12px;
        border: none;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }

      .confirm-bar .btn-yes {
        background: #fff;
        color: var(--error-color, #ef5350);
      }

      .confirm-bar .btn-no {
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
      }

      /* ── Track list ──────────────────── */
      .track-list {
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
        border-radius: 8px;
        overflow: hidden;
      }

      .track-list-header {
        display: grid;
        grid-template-columns: 40px 1fr 1fr 0.8fr 32px 32px;
        align-items: center;
        height: 36px;
        padding: 0 12px;
        gap: 8px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--secondary-text-color);
        border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
        background: var(--card-background-color, #1e1e1e);
      }

      .track-list-header .hdr-duration {
        text-align: right;
      }

      .track-row-wrap {
        display: flex;
        align-items: center;
      }

      .track-remove {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: var(--secondary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        opacity: 0;
        transition: opacity 0.1s;
        flex-shrink: 0;
      }

      .track-row-wrap:hover .track-remove {
        opacity: 1;
      }

      .track-remove:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
        color: var(--error-color, #ef5350);
      }

      .track-remove litgui-icon {
        --mdc-icon-size: 16px;
      }

      /* ── Empty state ───────────────── */
      .empty-state {
        text-align: center;
        padding: 64px 24px;
        color: var(--secondary-text-color);
      }

      .empty-state litgui-icon {
        --mdc-icon-size: 48px;
        opacity: 0.3;
        margin-bottom: 16px;
      }

      .empty-state .empty-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-text-color);
        margin-bottom: 8px;
      }

      .empty-state .empty-desc {
        font-size: 14px;
      }

      /* ── Loading ───────────────────── */
      @keyframes shimmer {
        0% { opacity: 0.3; }
        50% { opacity: 0.15; }
        100% { opacity: 0.3; }
      }

      .skeleton-header {
        display: flex;
        gap: var(--volumio-space-lg, 24px);
        margin-bottom: var(--volumio-space-xl, 32px);
      }

      .skeleton-icon {
        width: 120px;
        height: 120px;
        border-radius: 8px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
        flex-shrink: 0;
      }

      .skeleton-meta {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 8px;
      }

      .skeleton-bar {
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-bar.title { width: 50%; height: 28px; }
      .skeleton-bar.detail { width: 30%; height: 14px; }

      .skeleton-tracks {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .skeleton-track {
        height: 48px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      /* ── Responsive ──────────────────── */
      @media (max-width: 768px) {
        .playlist-header {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .playlist-icon-box {
          width: 100px;
          height: 100px;
        }

        .playlist-meta {
          align-items: center;
        }

        .playlist-actions {
          justify-content: center;
          flex-wrap: wrap;
        }

        .track-list-header {
          grid-template-columns: 40px 1fr 0.8fr 60px 32px;
        }

        .track-list-header .hdr-album {
          display: none;
        }
      }
    `}constructor(){super(),this.playlistName="",this.playlistUri="",this.tracks=[],this.loading=!1,this.currentUri="",this.volumioUrl="",this._confirmDelete=!1}render(){if(this.loading)return this._renderSkeleton();const t=this.tracks.length,e=this.tracks.reduce((t,e)=>t+(e.duration||0),0);return N`
      <div class="playlist-header">
        <div class="playlist-icon-box">
          <litgui-icon icon="mdi:playlist-music"></litgui-icon>
        </div>
        <div class="playlist-meta">
          <span class="meta-type">Playlist</span>
          <div class="playlist-title">${this.playlistName||"Unknown Playlist"}</div>
          <div class="meta-details">
            ${t>0?N`<span class="detail">${t} track${1!==t?"s":""}</span>`:""}
            ${t>0&&e>0?N`<span class="sep">·</span>`:""}
            ${e>0?N`<span class="detail">${_t(e)}</span>`:""}
          </div>
          <div class="playlist-actions">
            <button class="action-btn primary" @click=${this._playAll} ?disabled=${0===t}>
              <litgui-icon icon="mdi:play"></litgui-icon> Play
            </button>
            <button class="action-btn secondary" @click=${this._enqueueAll} ?disabled=${0===t}>
              <litgui-icon icon="mdi:playlist-plus"></litgui-icon> Enqueue
            </button>
            <button class="action-btn danger" @click=${()=>{this._confirmDelete=!0}}>
              <litgui-icon icon="mdi:delete-outline"></litgui-icon> Delete
            </button>
          </div>
        </div>
      </div>

      ${this._confirmDelete?N`
        <div class="confirm-bar">
          <span>Delete "${this.playlistName}"?</span>
          <button class="btn-yes" @click=${this._deletePlaylist}>Yes, delete</button>
          <button class="btn-no" @click=${()=>{this._confirmDelete=!1}}>Cancel</button>
        </div>
      `:""}

      ${0===t?N`
          <div class="empty-state">
            <litgui-icon icon="mdi:playlist-music-outline"></litgui-icon>
            <div class="empty-title">Empty playlist</div>
            <div class="empty-desc">Add tracks from browse or search.</div>
          </div>
        `:N`
          <div class="track-list">
            <div class="track-list-header">
              <span>#</span>
              <span>Title</span>
              <span>Artist</span>
              <span class="hdr-album">Album</span>
              <span></span>
              <span></span>
            </div>
            ${this.tracks.map((t,e)=>{const i=xt(t.albumart,this.volumioUrl,this.configEntryId);return N`
                <div class="track-row-wrap">
                  <volumio-track-card
                    style="flex:1;min-width:0"
                    .index=${e+1}
                    title="${t.title||t.name||""}"
                    artist="${t.artist||""}"
                    album="${t.album||""}"
                    .duration=${t.duration||0}
                    uri="${t.uri||""}"
                    albumart="${i}"
                    service="${t.service||""}"
                    type="${t.type||"song"}"
                    ?is-playing=${t.uri===this.currentUri}
                    @volumio-track-click=${this._onTrackClick}
                  ></volumio-track-card>
                  <button
                    class="track-remove"
                    @click=${e=>this._onRemoveTrack(e,t)}
                    title="Remove from playlist"
                  >
                    <litgui-icon icon="mdi:close"></litgui-icon>
                  </button>
                </div>
              `})}
          </div>
        `}
    `}_renderSkeleton(){return N`
      <div class="skeleton-header">
        <div class="skeleton-icon"></div>
        <div class="skeleton-meta">
          <div class="skeleton-bar title"></div>
          <div class="skeleton-bar detail"></div>
        </div>
      </div>
      <div class="skeleton-tracks">
        ${Array(6).fill(0).map(()=>N`<div class="skeleton-track"></div>`)}
      </div>
    `}_playAll(){this.dispatchEvent(new CustomEvent("volumio-playlist-play",{detail:{name:this.playlistName},bubbles:!0,composed:!0}))}_enqueueAll(){this.dispatchEvent(new CustomEvent("volumio-playlist-enqueue",{detail:{name:this.playlistName},bubbles:!0,composed:!0}))}_deletePlaylist(){this._confirmDelete=!1,this.dispatchEvent(new CustomEvent("volumio-playlist-delete",{detail:{name:this.playlistName},bubbles:!0,composed:!0}))}_onTrackClick(t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("volumio-track-click",{detail:t.detail,bubbles:!0,composed:!0}))}_onRemoveTrack(t,e){t.stopPropagation(),this.dispatchEvent(new CustomEvent("volumio-playlist-remove-track",{detail:{playlistName:this.playlistName,uri:e.uri,service:e.service||""},bubbles:!0,composed:!0}))}});const Jt={mpd:"Local",qobuz:"Qobuz",tidal:"TIDAL",spotify:"Spotify",spop:"Spotify",webradio:"Radio",pandora:"Pandora",youtube:"YouTube",youtube2:"YouTube",ytmusic:"YouTube Music"};customElements.define("volumio-favorites-view",class extends rt{static get properties(){return{items:{type:Array},loading:{type:Boolean},currentUri:{type:String,attribute:"current-uri"},volumioUrl:{type:String,attribute:"volumio-url"},configEntryId:{type:String,attribute:"config-entry-id"}}}static get styles(){return o`
      :host {
        display: block;
        padding: var(--volumio-space-lg, 24px);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--volumio-space-lg, 24px);
      }

      .title {
        font-size: 24px;
        font-weight: 700;
        color: var(--primary-text-color);
      }

      .count {
        font-size: 14px;
        color: var(--secondary-text-color);
        margin-left: 12px;
      }

      /* ── Favorites list ────────────── */
      .favorites-list {
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
        border-radius: 8px;
        overflow: hidden;
      }

      .fav-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 16px;
        cursor: pointer;
        transition: background 0.1s;
        border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.04));
      }

      .fav-item:last-child {
        border-bottom: none;
      }

      .fav-item:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.06));
      }

      .fav-item.playing {
        border-left: 3px solid var(--primary-color, #03a9f4);
      }

      .fav-item.playing .fav-title {
        color: var(--primary-color, #03a9f4);
      }

      .fav-art {
        width: 44px;
        height: 44px;
        border-radius: 4px;
        overflow: hidden;
        flex-shrink: 0;
        background: var(--card-background-color, #2a2a2a);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .fav-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .fav-art litgui-icon {
        --mdc-icon-size: 20px;
        color: var(--secondary-text-color);
        opacity: 0.4;
      }

      .fav-art:empty::after {
        content: "";
        display: block;
        width: 20px;
        height: 20px;
        background: var(--secondary-text-color);
        opacity: 0.4;
        mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'/%3E%3C/svg%3E");
        -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'/%3E%3C/svg%3E");
        mask-size: contain;
        -webkit-mask-size: contain;
      }

      .fav-info {
        flex: 1;
        min-width: 0;
      }

      .fav-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--primary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .fav-meta {
        font-size: 13px;
        color: var(--secondary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 2px;
      }

      .fav-service {
        font-size: 11px;
        color: var(--secondary-text-color);
        opacity: 0.6;
        text-transform: capitalize;
        flex-shrink: 0;
      }

      .fav-context {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: var(--secondary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        opacity: 0;
        transition: opacity 0.1s;
        flex-shrink: 0;
      }

      .fav-item:hover .fav-context {
        opacity: 1;
      }

      .fav-context:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
        color: var(--primary-text-color);
      }

      .fav-context litgui-icon {
        --mdc-icon-size: 18px;
      }

      /* ── Empty state ───────────────── */
      .empty-state {
        text-align: center;
        padding: 64px 24px;
        color: var(--secondary-text-color);
      }

      .empty-state litgui-icon {
        --mdc-icon-size: 48px;
        opacity: 0.3;
        margin-bottom: 16px;
      }

      .empty-state .empty-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-text-color);
        margin-bottom: 8px;
      }

      .empty-state .empty-desc {
        font-size: 14px;
        max-width: 360px;
        margin: 0 auto;
        line-height: 1.5;
      }

      /* ── Loading ───────────────────── */
      @keyframes shimmer {
        0% { opacity: 0.3; }
        50% { opacity: 0.15; }
        100% { opacity: 0.3; }
      }

      .skeleton-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 16px;
      }

      .skeleton-art {
        width: 44px;
        height: 44px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
        flex-shrink: 0;
      }

      .skeleton-lines {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .skeleton-bar {
        height: 14px;
        border-radius: 4px;
        background: var(--secondary-text-color, #888);
        animation: shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-bar.wide { width: 55%; }
      .skeleton-bar.narrow { width: 35%; }
    `}constructor(){super(),this.items=[],this.loading=!1,this.currentUri="",this.volumioUrl=""}render(){return this.loading?this._renderSkeleton():N`
      <div class="header">
        <div>
          <span class="title">Favorites</span>
          ${this.items.length>0?N`<span class="count">${this.items.length} item${1!==this.items.length?"s":""}</span>`:""}
        </div>
      </div>

      ${0===this.items.length?N`
          <div class="empty-state">
            <litgui-icon icon="mdi:heart-outline"></litgui-icon>
            <div class="empty-title">No favorites yet</div>
            <div class="empty-desc">Tap the heart icon on any track, album, or artist to add it here.</div>
          </div>
        `:N`
          <div class="favorites-list">
            ${this.items.map(t=>{const e=xt(t.albumart,this.volumioUrl,this.configEntryId),i=t.uri===this.currentUri,s=[t.artist,t.album].filter(Boolean).join(" — ");return N`
                <div
                  class="fav-item ${i?"playing":""}"
                  @click=${()=>this._onItemClick(t)}
                  @contextmenu=${e=>this._onContextMenu(e,t)}
                >
                  <div class="fav-art">
                    ${e?N`<img src="${e}" alt="" loading="lazy" @error=${t=>{t.target.remove()}} />`:N`<litgui-icon icon="mdi:music-note"></litgui-icon>`}
                  </div>
                  <div class="fav-info">
                    <div class="fav-title">${t.title||"—"}</div>
                    ${s?N`<div class="fav-meta">${s}</div>`:""}
                  </div>
                  <span class="fav-service">${a=t.service,a?Jt[a]||a.charAt(0).toUpperCase()+a.slice(1):""}</span>
                  <button
                    class="fav-context"
                    @click=${e=>this._onDotsClick(e,t)}
                    title="More actions"
                  >
                    <litgui-icon icon="mdi:dots-vertical"></litgui-icon>
                  </button>
                </div>
              `;var a})}
          </div>
        `}
    `}_renderSkeleton(){return N`
      <div class="header">
        <span class="title">Favorites</span>
      </div>
      <div class="favorites-list">
        ${Array(5).fill(0).map(()=>N`
          <div class="skeleton-item">
            <div class="skeleton-art"></div>
            <div class="skeleton-lines">
              <div class="skeleton-bar wide"></div>
              <div class="skeleton-bar narrow"></div>
            </div>
          </div>
        `)}
      </div>
    `}_onItemClick(t){this.dispatchEvent(new CustomEvent("volumio-track-click",{detail:{uri:t.uri,title:t.title||"",artist:t.artist||"",album:t.album||"",albumart:t.albumart||"",service:t.service||"",type:t.type||"song"},bubbles:!0,composed:!0}))}_onDotsClick(t,e){t.stopPropagation(),t.preventDefault();const i=t.currentTarget.getBoundingClientRect();this._fireContextMenu(i.right,i.bottom,e)}_onContextMenu(t,e){t.preventDefault(),t.stopPropagation(),this._fireContextMenu(t.clientX,t.clientY,e)}_fireContextMenu(t,e,i){this.dispatchEvent(new CustomEvent("volumio-context-menu",{detail:{uri:i.uri,title:i.title||"",artist:i.artist||"",album:i.album||"",albumart:i.albumart||"",service:i.service||"",type:i.type||"song",x:t,y:e,context:"favorite"},bubbles:!0,composed:!0}))}});customElements.define("volumio-history-view",class extends rt{static get properties(){return{history:{type:Array},currentUri:{type:String,attribute:"current-uri"},volumioUrl:{type:String,attribute:"volumio-url"},configEntryId:{type:String,attribute:"config-entry-id"}}}static get styles(){return o`
      :host {
        display: block;
        padding: var(--volumio-space-lg, 24px);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--volumio-space-lg, 24px);
      }

      .title {
        font-size: 24px;
        font-weight: 700;
        color: var(--primary-text-color);
      }

      .count {
        font-size: 14px;
        color: var(--secondary-text-color);
        margin-left: 12px;
      }

      .clear-btn {
        padding: 8px 20px;
        border-radius: 20px;
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        background: transparent;
        color: var(--secondary-text-color);
        font-size: 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: background 0.15s, color 0.15s;
      }

      .clear-btn:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
        color: var(--primary-text-color);
      }

      .clear-btn litgui-icon {
        --mdc-icon-size: 16px;
      }

      /* ── Date groups ───────────────── */
      .date-group {
        margin-bottom: var(--volumio-space-lg, 24px);
      }

      .date-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--secondary-text-color);
        padding: 0 0 8px 0;
        border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
        margin-bottom: 4px;
      }

      /* ── History items ─────────────── */
      .history-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 16px;
        cursor: pointer;
        transition: background 0.1s;
        border-radius: 6px;
      }

      .history-item:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.06));
      }

      .history-item.playing {
        border-left: 3px solid var(--primary-color, #03a9f4);
      }

      .history-item.playing .hi-title {
        color: var(--primary-color, #03a9f4);
      }

      .hi-art {
        width: 40px;
        height: 40px;
        border-radius: 4px;
        overflow: hidden;
        flex-shrink: 0;
        background: var(--card-background-color, #2a2a2a);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .hi-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .hi-art:empty::after {
        content: "";
        display: block;
        width: 18px;
        height: 18px;
        background: var(--secondary-text-color);
        opacity: 0.4;
        mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'/%3E%3C/svg%3E");
        -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'/%3E%3C/svg%3E");
        mask-size: contain;
        -webkit-mask-size: contain;
      }

      .hi-art litgui-icon {
        --mdc-icon-size: 18px;
        color: var(--secondary-text-color);
        opacity: 0.4;
      }

      .hi-info {
        flex: 1;
        min-width: 0;
      }

      .hi-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--primary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hi-meta {
        font-size: 13px;
        color: var(--secondary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 1px;
      }

      .hi-time {
        font-size: 12px;
        color: var(--secondary-text-color);
        opacity: 0.6;
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
      }

      .hi-context {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: var(--secondary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        opacity: 0;
        transition: opacity 0.1s;
        flex-shrink: 0;
      }

      .history-item:hover .hi-context {
        opacity: 1;
      }

      .hi-context:hover {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
        color: var(--primary-text-color);
      }

      .hi-context litgui-icon {
        --mdc-icon-size: 18px;
      }

      /* ── Empty state ───────────────── */
      .empty-state {
        text-align: center;
        padding: 64px 24px;
        color: var(--secondary-text-color);
      }

      .empty-state litgui-icon {
        --mdc-icon-size: 48px;
        opacity: 0.3;
        margin-bottom: 16px;
      }

      .empty-state .empty-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-text-color);
        margin-bottom: 8px;
      }

      .empty-state .empty-desc {
        font-size: 14px;
      }
    `}constructor(){super(),this.history=[],this.currentUri="",this.volumioUrl=""}render(){if(0===this.history.length)return N`
        <div class="header">
          <span class="title">History</span>
        </div>
        <div class="empty-state">
          <litgui-icon icon="mdi:history"></litgui-icon>
          <div class="empty-title">No listening history yet</div>
          <div class="empty-desc">Play some music!</div>
        </div>
      `;const t=this._groupByDate(this.history);return N`
      <div class="header">
        <div>
          <span class="title">History</span>
          <span class="count">${this.history.length} track${1!==this.history.length?"s":""}</span>
        </div>
        <button class="clear-btn" @click=${this._onClear}>
          <litgui-icon icon="mdi:delete-outline"></litgui-icon> Clear History
        </button>
      </div>

      ${t.map(t=>N`
        <div class="date-group">
          <div class="date-label">${t.label}</div>
          ${t.items.map(t=>{const e=xt(t.albumart,this.volumioUrl,this.configEntryId),i=t.uri===this.currentUri,s=[t.artist,t.album].filter(Boolean).join(" — "),a=this._formatTime(t.timestamp);return N`
              <div
                class="history-item ${i?"playing":""}"
                @click=${()=>this._onItemClick(t)}
                @contextmenu=${e=>this._onContextMenu(e,t)}
              >
                <div class="hi-art">
                  ${e?N`<img src="${e}" alt="" loading="lazy" @error=${t=>{t.target.remove()}} />`:N`<litgui-icon icon="mdi:music-note"></litgui-icon>`}
                </div>
                <div class="hi-info">
                  <div class="hi-title">${t.title||"—"}</div>
                  ${s?N`<div class="hi-meta">${s}</div>`:""}
                </div>
                <span class="hi-time">${a}</span>
                <button
                  class="hi-context"
                  @click=${e=>this._onDotsClick(e,t)}
                  title="More actions"
                >
                  <litgui-icon icon="mdi:dots-vertical"></litgui-icon>
                </button>
              </div>
            `})}
        </div>
      `)}
    `}_groupByDate(t){const e=new Map,i=new Date,s=i.toDateString(),a=new Date(i);a.setDate(a.getDate()-1);const o=a.toDateString();for(const i of t){const t=new Date(i.timestamp),a=t.toDateString();let r;r=a===s?"Today":a===o?"Yesterday":t.toLocaleDateString(void 0,{weekday:"long",month:"short",day:"numeric"}),e.has(r)||e.set(r,[]),e.get(r).push(i)}return Array.from(e.entries()).map(([t,e])=>({label:t,items:e}))}_formatTime(t){return new Date(t).toLocaleTimeString(void 0,{hour:"numeric",minute:"2-digit"})}_onItemClick(t){this.dispatchEvent(new CustomEvent("volumio-track-click",{detail:{uri:t.uri,title:t.title||"",artist:t.artist||"",album:t.album||"",albumart:t.albumart||"",service:t.service||"",type:"song"},bubbles:!0,composed:!0}))}_onClear(){this.dispatchEvent(new CustomEvent("volumio-history-clear",{bubbles:!0,composed:!0}))}_onDotsClick(t,e){t.stopPropagation(),t.preventDefault();const i=t.currentTarget.getBoundingClientRect();this._fireContextMenu(i.right,i.bottom,e)}_onContextMenu(t,e){t.preventDefault(),t.stopPropagation(),this._fireContextMenu(t.clientX,t.clientY,e)}_fireContextMenu(t,e,i){this.dispatchEvent(new CustomEvent("volumio-context-menu",{detail:{uri:i.uri,title:i.title||"",artist:i.artist||"",album:i.album||"",albumart:i.albumart||"",service:i.service||"",type:"song",x:t,y:e,context:"history"},bubbles:!0,composed:!0}))}});customElements.define("volumio-settings-panel",class extends rt{static get properties(){return{clickAction:{type:String,attribute:"click-action"},queueThumbnails:{type:Boolean,attribute:"queue-thumbnails"},browseViewMode:{type:String,attribute:"browse-view-mode"},aboutInfo:{type:Object},standalone:{type:Boolean},uiPort:{type:String,attribute:"ui-port"}}}static get styles(){return o`
      :host {
        display: block;
        padding: var(--volumio-space-lg, 24px);
        max-width: 640px;
      }

      .header {
        margin-bottom: var(--volumio-space-xl, 32px);
      }

      .title {
        font-size: 24px;
        font-weight: 700;
        color: var(--primary-text-color);
      }

      /* ── Sections ──────────────────── */
      .section {
        margin-bottom: var(--volumio-space-xl, 32px);
      }

      .section-title {
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--secondary-text-color);
        padding-bottom: 8px;
        border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
        margin-bottom: var(--volumio-space-md, 16px);
      }

      /* ── Setting row ───────────────── */
      .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 0;
        gap: 16px;
      }

      .setting-row + .setting-row {
        border-top: 1px solid var(--divider-color, rgba(255, 255, 255, 0.04));
      }

      .setting-info {
        flex: 1;
        min-width: 0;
      }

      .setting-label {
        font-size: 15px;
        color: var(--primary-text-color);
        font-weight: 500;
      }

      .setting-desc {
        font-size: 13px;
        color: var(--secondary-text-color);
        margin-top: 2px;
        line-height: 1.4;
      }

      /* ── Toggle switch ─────────────── */
      .toggle {
        position: relative;
        width: 44px;
        height: 24px;
        flex-shrink: 0;
      }

      .toggle input {
        opacity: 0;
        width: 0;
        height: 0;
        position: absolute;
      }

      .toggle-track {
        position: absolute;
        inset: 0;
        border-radius: 12px;
        background: var(--divider-color, rgba(255, 255, 255, 0.2));
        cursor: pointer;
        transition: background 0.2s;
      }

      .toggle input:checked + .toggle-track {
        background: var(--primary-color, #03a9f4);
      }

      .toggle-track::after {
        content: "";
        position: absolute;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #fff;
        top: 3px;
        left: 3px;
        transition: transform 0.2s;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      }

      .toggle input:checked + .toggle-track::after {
        transform: translateX(20px);
      }

      /* ── Segmented control ─────────── */
      .segmented {
        display: flex;
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        border-radius: 8px;
        overflow: hidden;
        flex-shrink: 0;
      }

      .seg-btn {
        padding: 6px 16px;
        border: none;
        background: transparent;
        color: var(--secondary-text-color);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }

      .seg-btn + .seg-btn {
        border-left: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
      }

      .seg-btn.active {
        background: var(--primary-color, #03a9f4);
        color: #fff;
      }

      .seg-btn:hover:not(.active) {
        background: var(--divider-color, rgba(255, 255, 255, 0.08));
        color: var(--primary-text-color);
      }

      /* ── About section ─────────────── */
      .about-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0;
      }

      .about-row + .about-row {
        border-top: 1px solid var(--divider-color, rgba(255, 255, 255, 0.04));
      }

      .about-key {
        font-size: 14px;
        color: var(--secondary-text-color);
      }

      .about-value {
        font-size: 14px;
        color: var(--primary-text-color);
        font-weight: 500;
        text-align: right;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 60%;
      }

      /* ── Volumio System links ──────── */
      .volumio-link-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 0;
        text-decoration: none;
        color: var(--primary-text-color);
        cursor: pointer;
        border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.04));
        transition: color 0.15s;
      }

      .volumio-link-row:last-child {
        border-bottom: none;
      }

      .volumio-link-row:hover {
        color: var(--primary-color);
      }

      .volumio-link-row .link-icon {
        --mdc-icon-size: 18px;
        opacity: 0.6;
        transition: opacity 0.15s;
      }

      .volumio-link-row:hover .link-icon {
        opacity: 1;
      }

      /* ── About attribution ─────────── */
      .about-attribution {
        display: flex;
        align-items: center;
        gap: 12px;
        padding-top: 12px;
        margin-top: 4px;
        border-top: 1px solid var(--divider-color, rgba(255, 255, 255, 0.04));
        color: var(--secondary-text-color);
        line-height: 1.4;
      }

      .about-attribution .brand-mark {
        width: 36px;
        height: 36px;
        flex-shrink: 0;
      }

      .about-attribution .brand-mark svg {
        width: 100%;
        height: 100%;
        display: block;
      }

      .about-attribution .brand-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .about-attribution .brand-name {
        font-size: 14px;
        color: var(--primary-text-color);
      }

      .about-attribution .brand-meta {
        font-size: 12px;
        opacity: 0.7;
      }

      .about-attribution a {
        color: inherit;
        text-decoration: none;
        opacity: 0.85;
        transition: opacity 0.15s;
      }

      .about-attribution a:hover {
        opacity: 1;
        text-decoration: underline;
      }

      .about-sep {
        margin: 0 6px;
        opacity: 0.4;
      }

      /* ── UI switcher dropdown ──────── */
      .ui-switch-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 0;
        gap: 16px;
      }
      .ui-switch-select {
        flex-shrink: 0;
        padding: 8px 12px;
        border-radius: 8px;
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        background: var(--card-background-color, #1e1e1e);
        color: var(--primary-text-color);
        font-size: 14px;
        cursor: pointer;
        min-width: 160px;
      }
      .ui-switch-select:focus {
        outline: none;
        border-color: var(--primary-color, #03a9f4);
      }
    `}constructor(){super(),this.clickAction="play_now",this.queueThumbnails=!0,this.browseViewMode="grid",this.aboutInfo={},this.standalone=!1,this.uiPort=""}render(){return N`
      <div class="header">
        <span class="title">Settings</span>
      </div>

      <div class="section">
        <div class="section-title">Behavior</div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Default click action</div>
            <div class="setting-desc">What happens when you click a track</div>
          </div>
          <div class="segmented">
            <button
              class="seg-btn ${"play_now"===this.clickAction?"active":""}"
              @click=${()=>this._onChange("clickAction","play_now")}
            >Play Now</button>
            <button
              class="seg-btn ${"add_to_queue"===this.clickAction?"active":""}"
              @click=${()=>this._onChange("clickAction","add_to_queue")}
            >Add to Queue</button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Appearance</div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Queue thumbnails</div>
            <div class="setting-desc">Show album art in the queue panel</div>
          </div>
          <label class="toggle">
            <input
              type="checkbox"
              .checked=${this.queueThumbnails}
              @change=${t=>this._onChange("queueThumbnails",t.target.checked)}
            />
            <span class="toggle-track"></span>
          </label>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Browse view</div>
            <div class="setting-desc">Default layout for browse lists</div>
          </div>
          <div class="segmented">
            <button
              class="seg-btn ${"grid"===this.browseViewMode?"active":""}"
              @click=${()=>this._onChange("browseViewMode","grid")}
            >Grid</button>
            <button
              class="seg-btn ${"list"===this.browseViewMode?"active":""}"
              @click=${()=>this._onChange("browseViewMode","list")}
            >List</button>
          </div>
        </div>
      </div>

      ${this.standalone?N`
        <div class="section">
          <div class="section-title">User Interface</div>
          <div class="ui-switch-row">
            <div class="setting-info">
              <div class="setting-label">Switch active interface</div>
              <div class="setting-desc">Change which UI Volumio serves. The page will reload after switching.</div>
            </div>
            <select class="ui-switch-select" @change=${this._onUiSwitch}>
              <option value="" selected disabled>Switch to…</option>
              <option value="litgui">LitGUI</option>
              <option value="manifest">Manifest</option>
              <option value="contemporary">Contemporary</option>
              <option value="classic">Classic</option>
            </select>
          </div>
        </div>
      `:""}

      ${this.aboutInfo.volumioUrl&&this.standalone&&"7777"===this.uiPort?N`
        <div class="section">
          <div class="section-title">Volumio System</div>
          <a class="volumio-link-row" href="${this.aboutInfo.volumioUrl}/plugin/miscellanea-my_music" target="_blank" rel="noopener noreferrer">
            <span>Sources</span>
            <litgui-icon class="link-icon" icon="mdi:open-in-new"></litgui-icon>
          </a>
          <a class="volumio-link-row" href="${this.aboutInfo.volumioUrl}/plugin/audio_interface-alsa_controller" target="_blank" rel="noopener noreferrer">
            <span>Playback Options</span>
            <litgui-icon class="link-icon" icon="mdi:open-in-new"></litgui-icon>
          </a>
          <a class="volumio-link-row" href="${this.aboutInfo.volumioUrl}/plugin/system_controller-network" target="_blank" rel="noopener noreferrer">
            <span>Network</span>
            <litgui-icon class="link-icon" icon="mdi:open-in-new"></litgui-icon>
          </a>
          <a class="volumio-link-row" href="${this.aboutInfo.volumioUrl}/plugin-manager" target="_blank" rel="noopener noreferrer">
            <span>Plugins</span>
            <litgui-icon class="link-icon" icon="mdi:open-in-new"></litgui-icon>
          </a>
          <a class="volumio-link-row" href="${this.aboutInfo.volumioUrl}/plugin/system_controller-system" target="_blank" rel="noopener noreferrer">
            <span>System</span>
            <litgui-icon class="link-icon" icon="mdi:open-in-new"></litgui-icon>
          </a>
        </div>
      `:""}

      <div class="section">
        <div class="section-title">About</div>
        ${this.aboutInfo.volumioUrl?N`
          <div class="about-row">
            <span class="about-key">Volumio URL</span>
            <span class="about-value">${this.aboutInfo.volumioUrl}</span>
          </div>
        `:""}
        ${this.aboutInfo.entityId?N`
          <div class="about-row">
            <span class="about-key">Entity</span>
            <span class="about-value">${this.aboutInfo.entityId}</span>
          </div>
        `:""}
        <div class="about-attribution">
          <div class="brand-mark">${Ut('<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 8 36 34" width="200" height="200">\n  <path d="M12 18 L5 28 L12 38" stroke="#1A1A1A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>\n  <path d="M28 38 L35 28 L28 18" stroke="#1A1A1A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>\n  <path d="M20 30 C20 30 15 20 15 16 C15 12 17 10 20 10 C23 10 25 12 25 16 C25 20 20 30 20 30Z" fill="#EF9F27" opacity="0.9"/>\n  <path d="M20 26 C20 26 17 20 17 18 C17 15 18 14 20 14 C22 14 23 15 23 18 C23 20 20 26 20 26Z" fill="#F5C475"/>\n</svg>')}</div>
          <div class="brand-text">
            <div class="brand-name">LitGUI for Volumio</div>
            <div class="brand-meta">
              v${this.aboutInfo.version||"unknown"}<span class="about-sep">·</span><a href="https://litgui.com" target="_blank" rel="noopener noreferrer">litgui.com</a>
            </div>
          </div>
        </div>
      </div>
    `}_onChange(t,e){this.dispatchEvent(new CustomEvent("volumio-setting-change",{detail:{key:t,value:e},bubbles:!0,composed:!0}))}_onUiSwitch(t){const e=t.target.value;if(!e)return;this.dispatchEvent(new CustomEvent("volumio-set-ui",{detail:{value:e,label:{litgui:"LitGUI",manifest:"Manifest",contemporary:"Contemporary",classic:"Classic"}[e]||e},bubbles:!0,composed:!0})),t.target.value=""}});const te={mpd:"Local",qobuz:"Qobuz",tidal:"TIDAL",spotify:"Spotify",spop:"Spotify",webradio:"Radio",pandora:"Pandora",youtube:"YouTube",youtube2:"YouTube",ytmusic:"YouTube Music"};function ee(t){return t?te[t]||t.charAt(0).toUpperCase()+t.slice(1):""}customElements.define("volumio-panel",class extends rt{static get properties(){return{hass:{type:Object},narrow:{type:Boolean},route:{type:Object},panel:{type:Object},_queue:{type:Array,state:!0},_activeView:{type:String,state:!0},_navMode:{type:String,state:!0},_isMobile:{type:Boolean,state:!0},_showQueue:{type:Boolean,state:!0},_showNavFlyout:{type:Boolean,state:!0},_isFavorite:{type:Boolean,state:!0},_browseStack:{type:Array,state:!0},_browseItems:{type:Array,state:!0},_browseLoading:{type:Boolean,state:!0},_browseContext:{type:Object,state:!0},_artistBio:{type:String,state:!0},_similarArtists:{type:Array,state:!0},_albumStory:{type:String,state:!0},_albumCredits:{type:Array,state:!0},_metadataLoading:{type:Object,state:!0},_searchResults:{type:Object,state:!0},_searchLoading:{type:Boolean,state:!0},_searchQuery:{type:String,state:!0},_searchTrail:{type:Array,state:!0},_browseSources:{type:Array,state:!0},_activeSourceUri:{type:String,state:!0},_devices:{type:Array,state:!0},_activeDeviceId:{type:String,state:!0},_ctxOpen:{type:Boolean,state:!0},_ctxX:{type:Number,state:!0},_ctxY:{type:Number,state:!0},_ctxItems:{type:Array,state:!0},_ctxTarget:{type:Object,state:!0},_ctxPlaylists:{type:Array,state:!0},_toastMessage:{type:String,state:!0},_toastOpen:{type:Boolean,state:!0},_toastUndo:{type:String,state:!0},_toastUndoData:{type:Object,state:!0},_queueConfirmClear:{type:Boolean,state:!0},_queueSaveOpen:{type:Boolean,state:!0},_queueSaveName:{type:String,state:!0},_dragIndex:{type:Number,state:!0},_dragOverIndex:{type:Number,state:!0},_playlistItems:{type:Array,state:!0},_playlistDetailItems:{type:Array,state:!0},_playlistDetailContext:{type:Object,state:!0},_playlistLoading:{type:Boolean,state:!0},_favoritesItems:{type:Array,state:!0},_favoritesLoading:{type:Boolean,state:!0},_history:{type:Array,state:!0},_settingClickAction:{type:String,state:!0},_settingQueueThumbnails:{type:Boolean,state:!0},_settingBrowseViewMode:{type:String,state:!0}}}static get styles(){return[lt,o`
        :host {
          display: block;
          height: 100%;
          background: var(--primary-background-color, #121212);
          color: var(--primary-text-color, #e0e0e0);
          font-family: var(--ha-font-family, Roboto, sans-serif);
          box-sizing: border-box;
          overflow: hidden;
        }

        *,
        *::before,
        *::after {
          box-sizing: border-box;
        }

        .shell {
          display: grid;
          grid-template-rows: auto 1fr auto;
          height: 100%;
        }

        /* ── Three-zone content area ─────────────── */
        .content-area {
          display: grid;
          grid-template-columns: auto 1fr auto;
          overflow: hidden;
          position: relative;
        }

        .left-zone {
          overflow: hidden;
          transition: width 0.2s ease;
        }

        .left-zone.pinned {
          width: var(--volumio-nav-width-pinned, 240px);
        }

        .left-zone.collapsed {
          width: var(--volumio-nav-width-collapsed, 56px);
        }

        .left-zone.hidden {
          width: 0;
        }

        .center-zone {
          overflow-y: auto;
          overflow-x: hidden;
          min-width: 0;
        }

        .right-zone {
          overflow: hidden;
          transition: width 0.2s ease;
        }

        .right-zone.pinned {
          width: var(--volumio-queue-width, 320px);
          border-left: 1px solid var(--divider-color, rgba(255,255,255,0.08));
          overflow-y: auto;
        }

        .right-zone.hidden {
          width: 0;
        }

        /* ── Flyout overlay ──────────────────────── */
        .flyout-scrim {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 190;
        }

        .flyout-panel {
          position: fixed;
          top: 0;
          bottom: 0;
          z-index: 200;
          transition: transform 0.2s ease-out;
        }

        .flyout-panel.left {
          left: 0;
          width: var(--volumio-nav-width-pinned, 240px);
        }

        .flyout-panel.right {
          right: 0;
          width: var(--volumio-queue-width, 320px);
        }

        /* ── Queue panel ─────────────────────────── */
        .queue-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .queue-header {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
          gap: 8px;
          flex-shrink: 0;
        }

        .queue-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--primary-text-color);
        }

        .queue-count {
          font-size: 12px;
          color: var(--secondary-text-color);
          flex: 1;
        }

        .queue-clear-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: none;
          background: transparent;
          color: var(--secondary-text-color);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }

        .queue-clear-btn:hover {
          background: var(--divider-color, rgba(255, 255, 255, 0.08));
          color: var(--primary-text-color);
        }

        .queue-clear-btn litgui-icon {
          --mdc-icon-size: 18px;
        }

        .queue-list {
          overflow-y: auto;
          flex: 1;
        }

        .queue-empty {
          padding: 32px 16px;
          text-align: center;
          color: var(--secondary-text-color);
          font-size: 14px;
        }

        .queue-item {
          display: flex;
          align-items: center;
          padding: 6px 16px;
          gap: 10px;
          cursor: pointer;
          transition: background 0.1s;
        }

        .queue-item:hover {
          background: var(--divider-color, rgba(255, 255, 255, 0.06));
        }

        .queue-item.playing {
          border-left: 3px solid var(--primary-color, #03a9f4);
        }

        .queue-item.playing .qi-title {
          color: var(--primary-color, #03a9f4);
        }

        .qi-art {
          width: 40px;
          height: 40px;
          border-radius: 4px;
          overflow: hidden;
          flex-shrink: 0;
          background: var(--card-background-color, #2a2a2a);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .qi-art img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .qi-art litgui-icon {
          --mdc-icon-size: 18px;
          color: var(--secondary-text-color);
          opacity: 0.4;
        }

        .qi-info {
          flex: 1;
          min-width: 0;
        }

        .qi-title {
          font-size: 13px;
          font-weight: 500;
          color: var(--primary-text-color);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .qi-artist {
          font-size: 12px;
          color: var(--secondary-text-color);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .qi-eq {
          --mdc-icon-size: 16px;
          color: var(--primary-color, #03a9f4);
          flex-shrink: 0;
        }

        /* ── Queue drag handle ───────────────────── */
        .qi-drag {
          width: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: grab;
          color: var(--secondary-text-color);
          opacity: 0;
          transition: opacity 0.1s;
          flex-shrink: 0;
          touch-action: none;
        }
        .qi-drag:active { cursor: grabbing; }
        .queue-item:hover .qi-drag { opacity: 0.6; }
        .qi-drag litgui-icon { --mdc-icon-size: 14px; }

        .queue-item.dragging {
          opacity: 0.4;
          background: var(--divider-color, rgba(255, 255, 255, 0.04));
        }

        .queue-item.drag-over-above {
          border-top: 2px solid var(--primary-color, #03a9f4);
        }
        .queue-item.drag-over-below {
          border-bottom: 2px solid var(--primary-color, #03a9f4);
        }

        /* ── Queue remove button ─────────────────── */
        .qi-remove {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: none;
          background: transparent;
          color: var(--secondary-text-color);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          opacity: 0;
          transition: opacity 0.1s, background 0.1s;
          flex-shrink: 0;
        }
        .queue-item:hover .qi-remove { opacity: 1; }
        .qi-remove:hover {
          background: var(--divider-color, rgba(255, 255, 255, 0.08));
          color: var(--error-color, #f44336);
        }
        .qi-remove litgui-icon { --mdc-icon-size: 14px; }

        /* ── Queue header actions ─────────────────── */
        .queue-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        /* ── Confirmation bar ─────────────────────── */
        .confirm-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          background: var(--card-background-color, #2a2a2a);
          border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
          font-size: 13px;
          color: var(--primary-text-color);
        }
        .confirm-bar .confirm-btns {
          display: flex;
          gap: 8px;
        }
        .confirm-bar button {
          padding: 4px 12px;
          border-radius: 4px;
          border: none;
          font-size: 12px;
          cursor: pointer;
        }
        .confirm-bar .btn-yes {
          background: var(--error-color, #f44336);
          color: #fff;
        }
        .confirm-bar .btn-no {
          background: var(--divider-color, rgba(255, 255, 255, 0.12));
          color: var(--primary-text-color);
        }

        /* ── Save as playlist dialog ──────────────── */
        .save-dialog {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
        }
        .save-dialog input {
          flex: 1;
          padding: 6px 10px;
          border-radius: 4px;
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
          background: transparent;
          color: var(--primary-text-color);
          font-size: 13px;
          outline: none;
        }
        .save-dialog input:focus {
          border-color: var(--primary-color, #03a9f4);
        }
        .save-dialog button {
          padding: 6px 12px;
          border-radius: 4px;
          border: none;
          font-size: 12px;
          cursor: pointer;
          background: var(--primary-color, #03a9f4);
          color: #fff;
        }

        /* ── Queue empty state ────────────────────── */
        .queue-empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 16px;
          text-align: center;
          gap: 12px;
          color: var(--secondary-text-color);
          font-size: 13px;
        }
        .queue-empty-state litgui-icon {
          --mdc-icon-size: 32px;
          opacity: 0.3;
        }
        .queue-empty-state .browse-btn {
          padding: 6px 16px;
          border-radius: 16px;
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
          background: transparent;
          color: var(--primary-text-color);
          font-size: 12px;
          cursor: pointer;
          margin-top: 4px;
        }
        .queue-empty-state .browse-btn:hover {
          background: var(--divider-color, rgba(255, 255, 255, 0.08));
        }

        /* ── Equalizer animation ──────────────────── */
        @keyframes eq-bar1 { 0%,100%{height:3px} 50%{height:12px} }
        @keyframes eq-bar2 { 0%,100%{height:8px} 50%{height:4px} }
        @keyframes eq-bar3 { 0%,100%{height:5px} 50%{height:11px} }
        .eq-bars {
          display: flex;
          align-items: flex-end;
          gap: 2px;
          height: 14px;
          flex-shrink: 0;
        }
        .eq-bars span {
          width: 3px;
          background: var(--primary-color, #03a9f4);
          border-radius: 1px;
        }
        .eq-bars span:nth-child(1) { animation: eq-bar1 0.8s ease-in-out infinite; }
        .eq-bars span:nth-child(2) { animation: eq-bar2 0.6s ease-in-out infinite 0.1s; }
        .eq-bars span:nth-child(3) { animation: eq-bar3 0.7s ease-in-out infinite 0.2s; }

        /* ── Placeholder views ───────────────────── */
        .placeholder-view {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: var(--volumio-space-xxl, 48px);
          text-align: center;
          gap: var(--volumio-space-md, 16px);
        }

        .placeholder-view litgui-icon {
          --mdc-icon-size: 48px;
          color: var(--secondary-text-color);
          opacity: 0.3;
        }

        .placeholder-view .view-title {
          font-size: 22px;
          font-weight: 700;
          color: var(--primary-text-color);
        }

        .placeholder-view .view-desc {
          font-size: 14px;
          color: var(--secondary-text-color);
        }

        /* ── Mobile shell (T48 Phase 1) ──────────── */
        .shell-mobile {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }
        .shell-mobile .mobile-main {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          min-height: 0;
        }
        .shell-mobile .flyout-panel.left {
          width: var(--volumio-nav-width-pinned, 240px);
        }
        .shell-mobile .flyout-panel.right {
          width: var(--volumio-mobile-drawer-width, min(320px, 86vw));
        }
        /* Left drawer: bound height only — volumio-left-nav scrolls internally via .nav-scroll */
        .shell-mobile .flyout-panel.left {
          height: 100dvh;
          max-height: 100dvh;
          overflow: hidden;
        }
        /* Right drawer (queue): no inner scroller, so the panel scrolls itself */
        .shell-mobile .flyout-panel.right {
          height: 100dvh;
          max-height: 100dvh;
          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        .shell-mobile .flyout-panel.left {
          padding-top: env(safe-area-inset-top, 0px);
        }
        .shell-mobile .flyout-panel.left,
        .shell-mobile .flyout-panel.right {
          background: var(--card-background-color, #1a1a1a);
        }

        .shell-mobile .mobile-row2 {
          display: flex;
          align-items: center;
          gap: 4px;
          min-height: 40px;
          padding: 0 4px;
          background: var(--card-background-color, #1a1a1a);
          border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
        }
        .shell-mobile .mobile-back {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: transparent;
          color: var(--primary-text-color);
          cursor: pointer;
          flex: 0 0 auto;
        }
        .shell-mobile .mobile-row2 volumio-breadcrumb-bar {
          flex: 1;
          min-width: 0;
        }
      `]}constructor(){super(),this._mode=this.hasAttribute("standalone")?"volumio":"ha",this._adapter=function(t="ha"){switch(t){case"volumio":return new Vt;case"ha":return new Ct;default:return console.warn(`[adapters] Unknown mode "${t}" — falling back to HA adapter`),new Ct}}(this._mode),this._adapterConnected=!1,this._queue=[],this._activeView="now-playing",this._navMode="collapsed",this._isMobile=!1,this._showQueue=!1,this._showNavFlyout=!1,this._isFavorite=!1,this._favoritesCache=[],this._lastUri=null,this._keyHandler=this._onKeyDown.bind(this),this._sentinelArmed=!1,this._sentinelQueued=!1,this._historySeeded=!1,this._browseStack=[],this._browseItems=[],this._browseLoading=!1,this._browseContext=null,this._artistBio=null,this._similarArtists=[],this._albumStory=null,this._albumCredits=[],this._metadataLoading={bio:!1,similar:!1,story:!1,credits:!1},this._metadataArtistKey=null,this._metadataAlbumKey=null,this._searchResults=null,this._searchLoading=!1,this._searchQuery="",this._searchTrail=[],this._browseSources=[],this._activeSourceUri="",this._devices=[],this._activeDeviceId="",this._ctxOpen=!1,this._ctxX=0,this._ctxY=0,this._ctxItems=[],this._ctxTarget=null,this._ctxPlaylists=[],this._toastMessage="",this._toastOpen=!1,this._toastUndo=null,this._toastUndoData=null,this._queueConfirmClear=!1,this._queueSaveOpen=!1,this._queueSaveName="",this._dragIndex=-1,this._dragOverIndex=-1,this._playlistItems=[],this._playlistDetailItems=[],this._playlistDetailContext=null,this._playlistLoading=!1,this._favoritesItems=[],this._favoritesLoading=!1;try{const t=JSON.parse(wt("volumio-ws-history","[]"));this._history=Array.isArray(t)?t:[]}catch{this._history=[]}this._settingClickAction=wt("volumio-default-click","play_now"),this._settingQueueThumbnails="false"!==wt("volumio-queue-thumbnails"),this._settingBrowseViewMode=wt("volumio-browse-view-mode","grid")}connectedCallback(){super.connectedCallback(),this._applyBreakpoint(),window.addEventListener("resize",this._onResize),window.addEventListener("keydown",this._keyHandler),window.addEventListener("popstate",this._onPopState),this._historySeeded||(this._historySeeded=!0,this._pushHistorySentinel()),this._adapter.onQueueChange(t=>{this._queue=(t||[]).filter(Boolean)}),this._adapter.onDevicesChange(({devices:t,activeId:e})=>{const i=this._activeDeviceId,s=e||"";this._devices=t,this._activeDeviceId=s,s&&i&&i!==s?this._onActiveDeviceSwitched():s&&!i&&this._adapter.ready&&0===this._browseSources.length&&this._fetchBrowseSources()}),this._adapter.onStateChange(()=>{this.requestUpdate()}),"volumio"===this._mode&&(this._adapter.connect({host:window.location.hostname,port:3e3}).catch(t=>{console.error("[volumio-panel] Adapter connect failed:",t)}),this._adapterConnected=!0)}disconnectedCallback(){super.disconnectedCallback(),this._adapter.disconnect(),window.removeEventListener("resize",this._onResize),window.removeEventListener("keydown",this._keyHandler),window.removeEventListener("popstate",this._onPopState)}_onResize=()=>{this._applyBreakpoint()};_onPopState=()=>{const t=this._sentinelArmed;this._sentinelArmed=!1,t&&this._canGoBack&&(this._onBack(),this._pushHistorySentinel())};_pushHistorySentinel(){if(!this._sentinelArmed&&!this._sentinelQueued){this._sentinelQueued=!0,queueMicrotask(()=>{this._sentinelQueued=!1});try{history.pushState({litgui:!0},""),this._sentinelArmed=!0}catch(t){}}}_applyBreakpoint(){this._isMobile=window.innerWidth<=768;const t=window.innerWidth;t>=1400?(this._navMode="pinned",this._showQueue=!0):t>=1024?this._navMode="collapsed":(this._navMode="hidden",this._showQueue=!1)}willUpdate(t){"ha"===this._mode&&this.hass&&(t.has("hass")||t.has("panel"))&&(this._adapterConnected?this._adapter.updateHass(this.hass,this.panel):(this._adapter.connect({hass:this.hass,panel:this.panel}),this._adapterConnected=!0))}updated(){if(!this._adapter.ready)return;0===this._browseSources.length&&this._fetchBrowseSources();const t=this._adapter.getState(),e=t.uri||null;e!==this._lastUri&&(this._lastUri=e,e?(this._checkFavorite(),this._recordHistory(t)):this._isFavorite=!1)}async _callService(t,e={}){return await this._adapter.call(t,e)}_getQualityInfo(){const t=this._adapter.getState();if("unavailable"===t.state)return null;return pt({trackType:t.trackType,samplerate:t.samplerate,bitdepth:t.bitdepth,bitrate:t.bitrate,isStream:"channel"===t._raw?.media_content_type})}render(){return this._isMobile?this._renderMobileLayout():this._renderDesktopLayout()}_renderDesktopLayout(){const t=this._adapter.getState(),e=this._getQualityInfo(),i=xt(t.albumArt,"",this._activeDeviceId),s=this._getNavSources();return N`
      <div class="shell"
        @volumio-context-menu=${this._onContextMenuRequest}
        @volumio-playlist-select=${this._onPlaylistSelect}
        @volumio-playlist-create=${this._onPlaylistCreate}
        @volumio-playlist-play=${this._onPlaylistPlay}
        @volumio-playlist-enqueue=${this._onPlaylistEnqueue}
        @volumio-playlist-delete=${this._onPlaylistDelete}
        @volumio-playlist-remove-track=${this._onPlaylistRemoveTrack}
        @volumio-history-clear=${this._onHistoryClear}
        @volumio-setting-change=${this._onSettingChange}
        @volumio-set-ui=${this._onSetUi}
      >
        <volumio-top-bar
          active-view="${this._activeView}"
          .breadcrumb=${[]}
          ?narrow=${this.narrow}
          ?show-back-button=${this._browseStack.length>0||"album-detail"===this._activeView||"artist-detail"===this._activeView||"playlist-detail"===this._activeView||!!this._searchQuery}
          .devices=${this._devices}
          active-device-id="${this._activeDeviceId}"
          @volumio-navigate=${this._onNavigate}
          @volumio-toggle-nav=${this._onToggleNav}
          @volumio-toggle-queue=${this._onToggleQueue}
          @volumio-back=${this._onBack}
          @volumio-search=${this._onSearch}
          @volumio-search-clear=${this._onSearchClear}
          @volumio-device-change=${this._onDeviceChange}
        ></volumio-top-bar>

        <div class="content-area">
          ${this._renderLeftZone(s)}

          <div class="center-zone">
            ${this._searchTrail.length>0&&("album-detail"===this._activeView||"artist-detail"===this._activeView)?N`
                  <volumio-breadcrumb-bar
                    .trail=${this._searchTrail}
                    @volumio-breadcrumb-click=${this._onSearchBreadcrumbClick}
                  ></volumio-breadcrumb-bar>
                `:this._browseStack.length>0&&("browse"===this._activeView||"album-detail"===this._activeView||"artist-detail"===this._activeView)?N`
                    <volumio-breadcrumb-bar
                      .trail=${this._browseStack}
                      @volumio-breadcrumb-click=${this._onBreadcrumbClick}
                    ></volumio-breadcrumb-bar>
                  `:""}
            ${this._renderCenterContent(t,e,i)}
          </div>

          ${this._renderRightZone()}
        </div>

        <volumio-player-bar
          player-state="${t.state}"
          title="${t.title}"
          artist="${t.artist}"
          album-art="${i}"
          .duration=${t.duration}
          .position=${t.position}
          position-updated-at="${t.positionUpdatedAt}"
          .volume=${t.volume}
          ?muted=${t.muted}
          ?shuffle=${t.shuffle}
          repeat="${t.repeat}"
          .quality=${e}
          source="${t.source}"
          .volumeEnabled=${t.volumeEnabled}
          .isFavorite=${this._isFavorite}
          @volumio-command=${this._onCommand}
          @volumio-navigate=${this._onNavigate}
          @volumio-toggle-favorite=${this._onToggleFavorite}
        ></volumio-player-bar>
      </div>

      ${this._showNavFlyout?N`
        <div class="flyout-scrim" @click=${()=>this._showNavFlyout=!1}></div>
        <div class="flyout-panel left">
          <volumio-left-nav
            .sources=${s}
            mode="flyout"
            .standalone=${"volumio"===this._mode}
            active-view="${this._activeView}"
            active-source="${this._activeSourceUri}"
            @volumio-navigate=${this._onNavigate}
            @volumio-nav-pin=${this._onNavPin}
          ></volumio-left-nav>
        </div>
      `:""}

      <volumio-context-menu
        ?open=${this._ctxOpen}
        .x=${this._ctxX}
        .y=${this._ctxY}
        .items=${this._ctxItems}
        .submenuItems=${this._ctxPlaylists}
        @volumio-context-action=${this._onContextAction}
        @volumio-context-close=${()=>{this._ctxOpen=!1}}
      ></volumio-context-menu>

      <volumio-toast-notification
        ?open=${this._toastOpen}
        message="${this._toastMessage}"
        undo-action="${this._toastUndo||""}"
        @volumio-toast-undo=${this._onToastUndo}
        @volumio-toast-dismiss=${()=>{this._toastOpen=!1}}
      ></volumio-toast-notification>
    `}get _canGoBack(){return this._searchTrail.length>0&&("album-detail"===this._activeView||"artist-detail"===this._activeView)||(!!this._searchQuery||("playlist-detail"===this._activeView||("album-detail"===this._activeView||"artist-detail"===this._activeView||this._browseStack.length>=1)))}get _mobileHasBreadcrumb(){const t=this._searchTrail.length>0&&("album-detail"===this._activeView||"artist-detail"===this._activeView),e=this._browseStack.length>0&&("browse"===this._activeView||"album-detail"===this._activeView||"artist-detail"===this._activeView);return t||e}_renderMobileLayout(){const t=this._adapter.getState(),e=this._getQualityInfo(),i=xt(t.albumArt,"",this._activeDeviceId),s=this._getNavSources();return N`
      <div class="shell-mobile"
        @volumio-context-menu=${this._onContextMenuRequest}
        @volumio-playlist-select=${this._onPlaylistSelect}
        @volumio-playlist-create=${this._onPlaylistCreate}
        @volumio-playlist-play=${this._onPlaylistPlay}
        @volumio-playlist-enqueue=${this._onPlaylistEnqueue}
        @volumio-playlist-delete=${this._onPlaylistDelete}
        @volumio-playlist-remove-track=${this._onPlaylistRemoveTrack}
        @volumio-history-clear=${this._onHistoryClear}
        @volumio-setting-change=${this._onSettingChange}
        @volumio-set-ui=${this._onSetUi}
      >
        <volumio-top-bar
          ?mobile=${!0}
          active-view="${this._activeView}"
          .breadcrumb=${[]}
          ?narrow=${this.narrow}
          ?show-back-button=${this._browseStack.length>0||"album-detail"===this._activeView||"artist-detail"===this._activeView||"playlist-detail"===this._activeView||!!this._searchQuery}
          .devices=${this._devices}
          active-device-id="${this._activeDeviceId}"
          @volumio-navigate=${this._onNavigate}
          @volumio-toggle-nav=${this._onToggleNav}
          @volumio-toggle-queue=${this._onToggleQueue}
          @volumio-back=${this._onBack}
          @volumio-search=${this._onSearch}
          @volumio-search-clear=${this._onSearchClear}
          @volumio-device-change=${this._onDeviceChange}
        ></volumio-top-bar>

        ${this._canGoBack||this._mobileHasBreadcrumb?N`
          <div class="mobile-row2">
            ${this._canGoBack?N`
              <button class="mobile-back" @click=${this._onBack} aria-label="Back">
                <litgui-icon icon="mdi:arrow-left"></litgui-icon>
              </button>
            `:""}
            ${this._mobileHasBreadcrumb?N`
              ${this._searchTrail.length>0&&("album-detail"===this._activeView||"artist-detail"===this._activeView)?N`
                    <volumio-breadcrumb-bar
                      .trail=${this._searchTrail}
                      @volumio-breadcrumb-click=${this._onSearchBreadcrumbClick}
                    ></volumio-breadcrumb-bar>
                  `:this._browseStack.length>0&&("browse"===this._activeView||"album-detail"===this._activeView||"artist-detail"===this._activeView)?N`
                      <volumio-breadcrumb-bar
                        .trail=${this._browseStack}
                        @volumio-breadcrumb-click=${this._onBreadcrumbClick}
                      ></volumio-breadcrumb-bar>
                    `:""}
            `:""}
          </div>
        `:""}

        <div class="mobile-main">
          ${this._renderCenterContent(t,e,i)}
        </div>

        <volumio-player-bar
          mini
          player-state="${t.state}"
          title="${t.title}"
          artist="${t.artist}"
          album-art="${i}"
          .duration=${t.duration}
          .position=${t.position}
          position-updated-at="${t.positionUpdatedAt}"
          .volume=${t.volume}
          ?muted=${t.muted}
          ?shuffle=${t.shuffle}
          repeat="${t.repeat}"
          .quality=${e}
          source="${t.source}"
          .volumeEnabled=${t.volumeEnabled}
          .isFavorite=${this._isFavorite}
          @volumio-command=${this._onCommand}
          @volumio-navigate=${this._onNavigate}
          @volumio-toggle-favorite=${this._onToggleFavorite}
        ></volumio-player-bar>

        ${this._showNavFlyout?N`
          <div class="flyout-scrim" @click=${()=>this._showNavFlyout=!1}></div>
          <div class="flyout-panel left">
            <volumio-left-nav
              .sources=${s}
              mode="flyout"
              .standalone=${"volumio"===this._mode}
              active-view="${this._activeView}"
              active-source="${this._activeSourceUri}"
              @volumio-navigate=${this._onNavigate}
              @volumio-nav-pin=${this._onNavPin}
            ></volumio-left-nav>
          </div>
        `:""}

        ${this._showQueue?N`
          <div class="flyout-scrim" @click=${()=>this._showQueue=!1}></div>
          <div class="flyout-panel right">${this._renderQueuePanel()}</div>
        `:""}

        <volumio-context-menu
          ?open=${this._ctxOpen}
          .x=${this._ctxX}
          .y=${this._ctxY}
          .items=${this._ctxItems}
          .submenuItems=${this._ctxPlaylists}
          @volumio-context-action=${this._onContextAction}
          @volumio-context-close=${()=>{this._ctxOpen=!1}}
        ></volumio-context-menu>

        <volumio-toast-notification
          ?open=${this._toastOpen}
          message="${this._toastMessage}"
          undo-action="${this._toastUndo||""}"
          @volumio-toast-undo=${this._onToastUndo}
          @volumio-toast-dismiss=${()=>{this._toastOpen=!1}}
        ></volumio-toast-notification>
      </div>
    `}_renderLeftZone(t){return"hidden"===this._navMode?N``:N`
      <div class="left-zone ${this._navMode}">
        <volumio-left-nav
          .sources=${t}
          mode="${this._navMode}"
          .standalone=${"volumio"===this._mode}
          active-view="${this._activeView}"
          active-source="${this._activeSourceUri}"
          @volumio-navigate=${this._onNavigate}
          @volumio-nav-pin=${this._onNavPin}
        ></volumio-left-nav>
      </div>
    `}_renderRightZone(){return this._showQueue?N`<div class="right-zone pinned">${this._renderQueuePanel()}</div>`:N``}_renderQueuePanel(){const t=this._adapter.getState().queuePosition,e=this._adapter.getVolumioUrl();return N`
      <div class="queue-panel">
        <div class="queue-header">
          <span class="queue-title">Queue</span>
          <span class="queue-count">${this._queue.length} track${1!==this._queue.length?"s":""}</span>
          <div class="queue-actions">
            <button class="queue-clear-btn" @click=${this._onQueueSaveStart} title="Save as playlist">
              <litgui-icon icon="mdi:content-save-outline"></litgui-icon>
            </button>
            <button class="queue-clear-btn" @click=${this._onQueueClearClick} title="Clear queue">
              <litgui-icon icon="mdi:delete-outline"></litgui-icon>
            </button>
          </div>
        </div>
        ${this._queueConfirmClear?N`
          <div class="confirm-bar">
            <span>Clear queue?</span>
            <div class="confirm-btns">
              <button class="btn-yes" @click=${this._onQueueClear}>Yes</button>
              <button class="btn-no" @click=${()=>{this._queueConfirmClear=!1}}>No</button>
            </div>
          </div>
        `:""}
        ${this._queueSaveOpen?N`
          <div class="save-dialog">
            <input
              type="text"
              placeholder="Playlist name"
              .value=${this._queueSaveName}
              @input=${t=>{this._queueSaveName=t.target.value}}
              @keydown=${t=>{"Enter"===t.key&&this._onQueueSaveConfirm(),"Escape"===t.key&&(this._queueSaveOpen=!1)}}
            />
            <button @click=${this._onQueueSaveConfirm}>Save</button>
          </div>
        `:""}
        <div class="queue-list">
          ${0===this._queue.length?N`
              <div class="queue-empty-state">
                <litgui-icon icon="mdi:playlist-music-outline"></litgui-icon>
                <div>Queue is empty</div>
                <div>Browse for music to start playing.</div>
                <button class="browse-btn" @click=${()=>this._onNavigate({detail:{view:"browse"}})}>Browse</button>
              </div>`:this._queue.map((i,s)=>i?N`
              <div
                class="queue-item ${s===t?"playing":""} ${s===this._dragIndex?"dragging":""} ${s===this._dragOverIndex?this._dragIndex<s?"drag-over-below":"drag-over-above":""}"
                @click=${()=>this._onQueueItemClick(s)}
                @contextmenu=${t=>this._onQueueContextMenu(t,i,s)}
              >
                <div class="qi-drag"
                  @pointerdown=${t=>this._onDragStart(t,s)}
                >
                  <litgui-icon icon="mdi:drag-horizontal-variant"></litgui-icon>
                </div>
                ${this._settingQueueThumbnails?N`
                  <div class="qi-art">
                    ${i.albumart?N`<img src="${xt(i.albumart,e,this._activeDeviceId)}" alt="" loading="lazy" />`:N`<litgui-icon icon="mdi:music-note"></litgui-icon>`}
                  </div>
                `:""}
                <div class="qi-info">
                  <div class="qi-title">${i.name||i.title||"—"}</div>
                  <div class="qi-artist">${i.artist||""}</div>
                </div>
                ${s===t?N`<div class="eq-bars"><span></span><span></span><span></span></div>`:""}
                <button class="qi-remove" @click=${t=>this._onQueueRemove(t,s)} title="Remove">
                  <litgui-icon icon="mdi:close"></litgui-icon>
                </button>
              </div>
            `:"")}
        </div>
      </div>
    `}_renderCenterContent(t,e,i){const s=this._adapter.getVolumioUrl();if("album-detail"!==this._activeView&&"artist-detail"!==this._activeView&&this._searchQuery)return this._renderSearchView(t,s);switch(this._activeView){case"now-playing":return N`
          <volumio-now-playing
            player-state="${t.state}"
            title="${t.title}"
            artist="${t.artist}"
            album="${t.album}"
            album-art="${i}"
            .quality=${e}
            source="${t.source}"
            .isFavorite=${this._isFavorite}
            @volumio-command=${this._onCommand}
            @volumio-navigate=${this._onNavigate}
            @volumio-toggle-favorite=${this._onToggleFavorite}
          ></volumio-now-playing>
        `;case"browse":return this._renderBrowseView(t,s);case"album-detail":return this._renderAlbumDetail(t,s);case"artist-detail":return this._renderArtistDetail(s);case"playlists":return this._renderPlaylistList();case"playlist-detail":return this._renderPlaylistDetail();case"favorites":return this._renderFavorites();case"history":return this._renderHistory();case"settings":return this._renderSettings();default:return this._renderPlaceholder("","mdi:help-circle",`Unknown view: ${this._activeView}`)}}_renderBrowseView(t,e){return 0===this._browseStack.length?N`
        <volumio-browse-source-grid
          .sources=${this._browseSources}
          volumio-url="${e}"
          config-entry-id="${this._activeDeviceId}"
          @volumio-source-select=${this._onSourceSelect}
        ></volumio-browse-source-grid>
      `:N`
      <volumio-browse-list
        .items=${this._browseItems}
        ?loading=${this._browseLoading}
        current-uri="${t.uri}"
        volumio-url="${e}"
        config-entry-id="${this._activeDeviceId}"
        @volumio-item-click=${this._onBrowseItemClick}
        @volumio-item-play=${this._onBrowseItemPlay}
      ></volumio-browse-list>
    `}_renderAlbumDetail(t,e){const i=this._browseContext||{};return N`
      <volumio-album-detail
        album-title="${i.title||""}"
        album-artist="${i.artist||""}"
        album-art="${i.albumart||""}"
        album-uri="${i.uri||""}"
        album-service="${i.service||""}"
        .tracks=${this._browseItems}
        ?loading=${this._browseLoading}
        current-uri="${t.uri}"
        volumio-url="${e}"
        config-entry-id="${this._activeDeviceId}"
        .story=${this._albumStory}
        .credits=${this._albumCredits}
        ?story-loading=${this._metadataLoading.story}
        ?credits-loading=${this._metadataLoading.credits}
        @volumio-track-click=${this._onTrackPlay}
        @volumio-album-play=${this._onAlbumPlay}
        @volumio-album-add-queue=${this._onAlbumAddQueue}
        @volumio-navigate=${this._onNavigate}
        @volumio-similar-artist-click=${this._onSimilarArtistClick}
      ></volumio-album-detail>
    `}_renderArtistDetail(t){const e=this._browseContext||{};return N`
      <volumio-artist-detail
        artist-name="${e.artist||e.title||""}"
        .items=${this._browseItems}
        ?loading=${this._browseLoading}
        volumio-url="${t}"
        config-entry-id="${this._activeDeviceId}"
        .bio=${this._artistBio}
        .similarArtists=${this._similarArtists}
        ?bio-loading=${this._metadataLoading.bio}
        ?similar-loading=${this._metadataLoading.similar}
        @volumio-card-click=${this._onBrowseItemClick}
        @volumio-card-play=${this._onBrowseItemPlay}
        @volumio-similar-artist-click=${this._onSimilarArtistClick}
      ></volumio-artist-detail>
    `}_renderSearchView(t,e){return N`
      <volumio-search-results
        .results=${this._searchResults}
        ?loading=${this._searchLoading}
        query="${this._searchQuery}"
        volumio-url="${e}"
        config-entry-id="${this._activeDeviceId}"
        current-uri="${t.uri}"
        @volumio-card-click=${this._onBrowseItemClick}
        @volumio-card-play=${this._onBrowseItemPlay}
        @volumio-track-click=${this._onTrackPlay}
      ></volumio-search-results>
    `}_renderPlaceholder(t,e,i){return N`
      <div class="placeholder-view">
        <litgui-icon icon="${e}"></litgui-icon>
        <div class="view-title">${t}</div>
        <div class="view-desc">${i}</div>
      </div>
    `}_renderPlaylistList(){return N`
      <volumio-playlist-list
        .playlists=${this._playlistItems}
        ?loading=${this._playlistLoading}
      ></volumio-playlist-list>
    `}_renderPlaylistDetail(){const t=this._playlistDetailContext||{},e=this._adapter.getState(),i=this._adapter.getVolumioUrl();return N`
      <volumio-playlist-detail
        playlist-name="${t.name||""}"
        playlist-uri="${t.uri||""}"
        .tracks=${this._playlistDetailItems}
        ?loading=${this._playlistLoading}
        current-uri="${e.uri}"
        volumio-url="${i}"
        config-entry-id="${this._activeDeviceId}"
        @volumio-track-click=${this._onTrackPlay}
      ></volumio-playlist-detail>
    `}_renderFavorites(){const t=this._adapter.getState(),e=this._adapter.getVolumioUrl();return N`
      <volumio-favorites-view
        .items=${this._favoritesItems}
        ?loading=${this._favoritesLoading}
        current-uri="${t.uri}"
        volumio-url="${e}"
        config-entry-id="${this._activeDeviceId}"
        @volumio-track-click=${this._onTrackPlay}
      ></volumio-favorites-view>
    `}_renderHistory(){const t=this._adapter.getState(),e=this._adapter.getVolumioUrl();return N`
      <volumio-history-view
        .history=${this._history}
        current-uri="${t.uri}"
        volumio-url="${e}"
        config-entry-id="${this._activeDeviceId}"
        @volumio-track-click=${this._onTrackPlay}
      ></volumio-history-view>
    `}_renderSettings(){return N`
      <volumio-settings-panel
        click-action="${this._settingClickAction}"
        ?queue-thumbnails=${this._settingQueueThumbnails}
        browse-view-mode="${this._settingBrowseViewMode}"
        .standalone=${"volumio"===this._mode}
        ui-port="${"undefined"!=typeof window&&window.location?window.location.port:""}"
        .aboutInfo=${{volumioUrl:this._adapter.getVolumioUrl(),entityId:this._adapter.entityId,version:"0.2.24"}}
      ></volumio-settings-panel>
    `}_onNavigate(t){const{view:e,source:i,sourceUri:s,artist:a,album:o,pluginName:r}=t.detail||{};if(!e)return;const n=this._activeView;switch(this._isMobile&&(this._showQueue=!1,this._showNavFlyout=!1),e){case"browse":this._activeView="browse",this._showNavFlyout=!1,this._searchTrail=[],this._searchQuery="",this._searchResults=null,s?(this._activeSourceUri=s||"",this._browseStack=[],this._browseTo(s,i||"Browse")):0===this._browseStack.length&&(this._activeSourceUri="",this._browseItems=[]);break;case"album-detail":if(o){const t=this._adapter.getState(),e=t.source||"",i=t.artist||"";this._enterAlbumDetail({title:o,artist:i,albumart:t.rawAlbumart||"",uri:"",service:e,searchTrail:[{title:"Now Playing",uri:"__now_playing__",view:"now-playing"},{title:o,uri:"",view:"album-detail"}]})}else this._activeView="album-detail",this._showNavFlyout=!1;break;case"artist-detail":if(a){const t=this._adapter.getState().source||"",e=`globalUriArtist/${a}`;this._enterArtistDetail({artist:a,uri:e,service:t,searchTrail:[{title:"Now Playing",uri:"__now_playing__",view:"now-playing"},{title:a,uri:e,view:"artist-detail",service:t}]})}else this._activeView="artist-detail",this._showNavFlyout=!1;break;case"playlists":this._activeView="playlists",this._showNavFlyout=!1,this._searchQuery="",this._searchResults=null,this._searchTrail=[],this._loadPlaylists();break;case"favorites":this._activeView="favorites",this._showNavFlyout=!1,this._searchQuery="",this._searchResults=null,this._searchTrail=[],this._loadFavorites();break;default:this._activeView=e,this._showNavFlyout=!1,this._searchQuery="",this._searchResults=null,this._searchTrail=[]}this._activeView!==n&&this._pushHistorySentinel()}_onToggleNav(){"hidden"===this._navMode?this._showNavFlyout=!this._showNavFlyout:"collapsed"===this._navMode?this._navMode="pinned":this._navMode="collapsed"}_onNavPin(t){this._navMode=t.detail.pinned?"pinned":"collapsed",this._showNavFlyout=!1}_onToggleQueue(){this._showQueue=!this._showQueue}_onBack(){if(this._sentinelArmed=!1,this._searchTrail.length>0&&("album-detail"===this._activeView||"artist-detail"===this._activeView))if(this._searchTrail.length>1){this._searchTrail=this._searchTrail.slice(0,-1);const t=this._searchTrail[this._searchTrail.length-1];"artist-detail"===t.view?(this._activeView="artist-detail",this._browseContext=t,this._browseToArtist(t.uri,t.title,t.service||"")):"album-detail"===t.view?(this._activeView="album-detail",this._browseContext={title:t.title||"",artist:"",albumart:"",uri:t.uri||"",service:t.service||""},t.uri&&this._loadBrowseItems(t.uri)):"playlist-detail"===t.view?(this._activeView="playlist-detail",this._browseContext={title:t.title||"",uri:t.uri||"",service:t.service||""},t.uri&&this._loadBrowseItems(t.uri)):"now-playing"===t.view?(this._activeView="now-playing",this._searchTrail=[]):(this._activeView="browse",this._searchTrail=[])}else{const t=this._searchTrail[0];t&&"now-playing"===t.view?this._activeView="now-playing":this._activeView="browse",this._searchTrail=[]}else{if(this._searchQuery)return this._searchQuery="",this._searchResults=null,void(this._searchTrail=[]);if("playlist-detail"!==this._activeView)if("album-detail"!==this._activeView&&"artist-detail"!==this._activeView)if(this._browseStack.length>1){this._browseStack=this._browseStack.slice(0,-1);const t=this._browseStack[this._browseStack.length-1];this._loadBrowseItems(t.uri)}else 1===this._browseStack.length?(this._browseStack=[],this._browseItems=[],this._activeSourceUri=""):"now-playing"!==this._activeView&&(this._activeView="now-playing");else this._activeView="browse";else this._activeView="playlists"}}async _onDeviceChange(t){const e=t?.detail?.config_entry_id;e&&e!==this._activeDeviceId&&await this._adapter.setDevice(e)}_onActiveDeviceSwitched(){this._browseStack=[],this._browseItems=[],this._browseLoading=!1,this._browseContext=null,this._artistBio=null,this._similarArtists=[],this._albumStory=null,this._albumCredits=[],this._metadataLoading={bio:!1,similar:!1,story:!1,credits:!1},this._metadataArtistKey=null,this._metadataAlbumKey=null,this._browseSources=[],this._activeSourceUri="",this._searchResults=null,this._searchLoading=!1,this._searchQuery="",this._searchTrail=[],this._playlistItems=[],this._playlistDetailItems=[],this._playlistDetailContext=null,this._playlistLoading=!1,this._favoritesItems=[],this._favoritesLoading=!1,this._favoritesCache=[],this._isFavorite=!1,this._lastUri=null,this._queue=[],this._queueConfirmClear=!1,this._queueSaveOpen=!1,this._queueSaveName="",this._dragIndex=-1,this._dragOverIndex=-1,this._ctxOpen=!1,this._ctxItems=[],this._ctxTarget=null,this._ctxPlaylists=[],this._toastOpen=!1,this._toastMessage="",this._toastUndo=null,this._toastUndoData=null,this._activeView="now-playing",this._adapter.ready&&this._fetchBrowseSources()}async _fetchBrowseSources(){if(this._adapter.ready)try{const t=await this._callService("get_browse_sources",{}),e=t?.response?.sources||[];e.length>0&&(this._browseSources=e)}catch(t){console.warn("[volumio-panel] get_browse_sources failed:",t.message)}}_getNavSources(){if(this._browseSources.length>0)return this._browseSources;const t=this._adapter.getState();return(t._raw?.source_list||[]).map(t=>({name:t,plugin_name:t.toLowerCase().replace(/\s+/g,""),plugin_type:"music_service",uri:"",albumart:""}))}async _browseTo(t,e){this._pushHistorySentinel(),this._browseStack=[...this._browseStack,{uri:t,title:e}],await this._loadBrowseItems(t)}async _browseToArtist(t,e,i){this._browseLoading=!0;try{if(i&&t.startsWith("globalUriArtist/")){const s=await this._resolveArtistUri(e,i);if(s&&(t=s,this._browseContext&&(this._browseContext={...this._browseContext,uri:t}),this._searchTrail.length>0)){const e=[...this._searchTrail],i=e[e.length-1];"artist-detail"===i.view&&(e[e.length-1]={...i,uri:t},this._searchTrail=e)}}const s=await this._callService("browse",{uri:t}),a=(s?.response?.navigation||s?.navigation||{}).lists||[],o=[];for(const t of a)if(t.items)for(const e of t.items)"song"!==e.type&&"track"!==e.type&&o.push(e);this._browseItems=o}catch(t){console.error("[volumio-panel] Artist browse failed:",t),this._browseItems=[]}this._browseLoading=!1}async _fetchArtistMetadata(t){if(!t)return this._artistBio=null,this._similarArtists=[],void(this._metadataArtistKey=null);if(this._metadataArtistKey===t)return;this._metadataArtistKey=t,this._artistBio=null,this._similarArtists=[],this._metadataLoading={...this._metadataLoading,bio:!0,similar:!0};const[e,i]=await Promise.allSettled([this._adapter.fetchArtistBio(t),this._adapter.fetchSimilarArtists(t)]);this._artistBio="fulfilled"===e.status?e.value:null,this._similarArtists="fulfilled"===i.status?i.value:[],this._metadataLoading={...this._metadataLoading,bio:!1,similar:!1}}async _fetchAlbumMetadata(t,e){if(!t||!e)return this._albumStory=null,this._albumCredits=[],void(this._metadataAlbumKey=null);const i=t+String.fromCharCode(0)+e;if(this._metadataAlbumKey===i)return;this._metadataAlbumKey=i,this._albumStory=null,this._albumCredits=[],this._metadataLoading={...this._metadataLoading,story:!0,credits:!0};const[s,a]=await Promise.allSettled([this._adapter.fetchAlbumStory(t,e),this._adapter.fetchAlbumCredits(t,e)]);this._albumStory="fulfilled"===s.status?s.value:null,this._albumCredits="fulfilled"===a.status?a.value:[],this._metadataLoading={...this._metadataLoading,story:!1,credits:!1}}_enterArtistDetail({artist:t,uri:e,service:i,searchTrail:s,pushHistory:a=!0}){a&&this._pushHistorySentinel(),this._activeView="artist-detail",this._showNavFlyout=!1,this._browseContext={title:t,artist:t,uri:e,service:i||""},void 0!==s&&(this._searchTrail=s),this._fetchArtistMetadata(t),this._browseToArtist(e,t,i||"")}_enterAlbumDetail({title:t,artist:e,albumart:i,uri:s,service:a,searchTrail:o,skipLoad:r,pushHistory:n=!0}){n&&this._pushHistorySentinel(),this._activeView="album-detail",this._showNavFlyout=!1,this._browseContext={title:t,artist:e||"",albumart:i||"",uri:s||"",service:a||""},this._browseItems=[],void 0!==o&&(this._searchTrail=o),this._fetchAlbumMetadata(e||"",t),r||(s?this._loadBrowseItems(s):e&&(this._browseLoading=!0,this._resolveAndBrowseAlbum(t,e,a||"")))}_onSimilarArtistClick(t){const{artist:e,uri:i}=t.detail||{};if(!e||!i)return;const s=this._browseContext?.service||"";let a=this._searchTrail.slice();if(0===a.length){const t=this._browseContext||{},e=this._activeView;"artist-detail"!==e&&"album-detail"!==e||a.push({title:t.title||t.artist||"",uri:t.uri||"",view:e,service:t.service||""})}a.push({title:e,uri:i,view:"artist-detail",service:s}),this._enterArtistDetail({artist:e,uri:i,service:s,searchTrail:a})}async _resolveArtistUri(t,e){try{const i=await this._callService("search",{query:t}),s=(i?.response?.navigation||i?.navigation||{}).lists||[],a=t.toLowerCase();for(const t of s){if((t.title||"").toLowerCase().includes("artist")&&t.items)for(const i of t.items)if(i.service===e&&i.title?.toLowerCase()===a)return i.uri}return null}catch{return null}}async _resolveAlbumUri(t,e,i){try{const s=await this._callService("search",{query:t}),a=(s?.response?.navigation||s?.navigation||{}).lists||[],o=t.toLowerCase(),r=e.toLowerCase();for(const t of a){if((t.title||"").toLowerCase().includes("album")&&t.items)for(const e of t.items)if(e.service===i&&e.title?.toLowerCase()===o&&e.artist?.toLowerCase()===r)return e}for(const t of a){if((t.title||"").toLowerCase().includes("album")&&t.items)for(const e of t.items)if(e.service===i&&e.title?.toLowerCase()===o)return e}for(const t of a){if((t.title||"").toLowerCase().includes("album")&&t.items)for(const e of t.items)if(e.title?.toLowerCase()===o&&e.artist?.toLowerCase()===r)return e}return null}catch{return null}}async _resolveAndBrowseAlbum(t,e,i){try{let s="";if(t){const a=await this._resolveAlbumUri(t,e,i);a&&(s=a.uri||"",a.albumart&&(this._browseContext={...this._browseContext,albumart:a.albumart}))}if(!s&&"mpd"===i&&e&&t&&(s=`albums://${encodeURIComponent(e)}/${encodeURIComponent(t)}`),s){if(this._browseContext={...this._browseContext,uri:s},this._searchTrail.length>0){const t=[...this._searchTrail],e=t[t.length-1];"album-detail"===e.view&&(t[t.length-1]={...e,uri:s},this._searchTrail=t)}await this._loadBrowseItems(s)}else this._browseLoading=!1}catch{this._browseLoading=!1}}async _loadBrowseItems(t){if(this._adapter.ready){this._browseLoading=!0,this._browseItems=[];try{const e=await this._callService("browse",{uri:t}),i=e?.response?.navigation||e?.navigation||{},s=i.info||null,a=i.lists||[],o=[];for(const t of a)t.items&&o.push(...t.items);this._browseItems=o;if(!!s&&("album"===s.type||!!s.album&&!!s.artist&&o.length>0&&o.every(t=>t&&"song"===t.type))){const e=this._adapter.getVolumioUrl(),i=s.title||s.album||"",a=s.artist||"";this._browseContext={title:i,artist:a,albumart:xt(s.albumart||"",e,this._activeDeviceId),uri:s.uri||t,service:s.service||""},this._activeView="album-detail",this._fetchAlbumMetadata(a,i)}}catch(t){console.error("[volumio-panel] Browse failed:",t),this._browseItems=[]}this._browseLoading=!1}}async _loadPlaylists(){if(this._adapter.ready){this._playlistLoading=!0;try{const t=await this._callService("browse",{uri:"playlists"}),e=(t?.response?.navigation||t?.navigation||{}).lists||[],i=[];for(const t of e)t.items&&i.push(...t.items);this._playlistItems=i}catch(t){console.error("[volumio-panel] Load playlists failed:",t),this._playlistItems=[]}this._playlistLoading=!1}}async _loadPlaylistDetail(t){if(this._adapter.ready){this._playlistLoading=!0,this._playlistDetailItems=[];try{const e=await this._callService("browse",{uri:t}),i=(e?.response?.navigation||e?.navigation||{}).lists||[],s=[];for(const t of i)t.items&&s.push(...t.items);this._playlistDetailItems=s}catch(t){console.error("[volumio-panel] Load playlist detail failed:",t),this._playlistDetailItems=[]}this._playlistLoading=!1}}_onPlaylistSelect(t){const{name:e,uri:i}=t.detail;this._pushHistorySentinel(),this._playlistDetailContext={name:e,uri:i},this._activeView="playlist-detail",this._loadPlaylistDetail(i)}async _onPlaylistCreate(t){const{name:e}=t.detail;try{await this._callService("playlist_create",{name:e}),this._showToast(`Playlist "${e}" created`),this._loadPlaylists()}catch(t){console.error("[volumio-panel] Create playlist failed:",t),this._showToast("Failed to create playlist")}}async _onPlaylistPlay(t){const{name:e}=t.detail;try{await this._callService("playlist_play",{name:e}),this._refreshQueue()}catch(t){console.error("[volumio-panel] Play playlist failed:",t)}}async _onPlaylistEnqueue(t){const{name:e}=t.detail;try{await this._callService("playlist_enqueue",{name:e}),this._refreshQueue(),this._showToast(`Playlist "${e}" added to queue`)}catch(t){console.error("[volumio-panel] Enqueue playlist failed:",t)}}async _onPlaylistDelete(t){const{name:e}=t.detail;try{await this._callService("playlist_delete",{name:e}),this._showToast(`Playlist "${e}" deleted`),"playlist-detail"===this._activeView&&this._playlistDetailContext?.name===e&&(this._activeView="playlists"),this._loadPlaylists()}catch(t){console.error("[volumio-panel] Delete playlist failed:",t),this._showToast("Failed to delete playlist")}}async _onPlaylistRemoveTrack(t){const{playlistName:e,uri:i,service:s}=t.detail;try{await this._callService("playlist_remove_track",{name:e,uri:i,service:s||void 0}),this._showToast("Track removed from playlist"),this._playlistDetailContext?.uri&&this._loadPlaylistDetail(this._playlistDetailContext.uri)}catch(t){console.error("[volumio-panel] Remove track from playlist failed:",t),this._showToast("Failed to remove track")}}async _loadFavorites(){if(this._adapter.ready){this._favoritesLoading=!0;try{const t=await this._adapter.call("favorites_list"),e=t?.response?.items||[];this._favoritesItems=e,this._favoritesCache=e}catch(t){console.error("[volumio-panel] Load favorites failed:",t),this._favoritesItems=[]}this._favoritesLoading=!1}}_recordHistory(t){if(!t.title||"unavailable"===t.state)return;const e=Date.now();let i=[...this._history];const s=i[0];if(s&&s.uri===t.uri&&e-s.timestamp<6e4)i[0]={...s,timestamp:e};else{const s={uri:t.uri,title:t.title,artist:t.artist,album:t.album,albumart:t.rawAlbumart||"",service:t.source,trackType:t.trackType,samplerate:t.samplerate,bitdepth:t.bitdepth,timestamp:e};i.unshift(s)}i.length>500&&(i=i.slice(0,500)),this._history=i,kt("volumio-ws-history",JSON.stringify(i))||(i=i.slice(0,250),this._history=i,kt("volumio-ws-history",JSON.stringify(i)))}_onHistoryClear(){this._history=[],function(t){try{return localStorage.removeItem(t),!0}catch{return!1}}("volumio-ws-history"),this._showToast("History cleared")}_onSettingChange(t){const{key:e,value:i}=t.detail;switch(e){case"clickAction":this._settingClickAction=i,kt("volumio-default-click",i);break;case"queueThumbnails":this._settingQueueThumbnails=i,kt("volumio-queue-thumbnails",String(i));break;case"browseViewMode":this._settingBrowseViewMode=i,kt("volumio-browse-view-mode",i)}}async _onSetUi(t){const{value:e,label:i}=t.detail||{};if(e){try{await this._adapter.callMethod("controller","miscellanea/appearance","setVolumio3UI",{volumio3_ui:{value:e,label:i||e}})}catch(t){return console.error("[volumio-panel] UI switch failed:",t),void this._showToast("Failed to switch UI")}this._showToast(`Switching to ${i||e}…`),setTimeout(()=>{"undefined"!=typeof window&&window.location&&(window.location.href=`http://${window.location.hostname}/playback`)},1500)}}_onSourceSelect(t){const{uri:e,name:i,plugin_name:s}=t.detail;this._activeSourceUri=e||"",this._browseStack=[],this._browseTo(e,i)}_onBrowseItemClick(t){const e=t.detail,i=e.type||"folder";if(new Set(["song","track","webradio","mywebradio","cuesong"]).has(i))this._onTrackPlay(t);else{if("album"===i){let t;return(this._searchQuery||this._searchTrail.length>0)&&(t=this._searchTrail.length>0?[...this._searchTrail]:[{title:`Search "${this._searchQuery}"`,uri:"__search__",view:"search"}],1===t.length&&e.service&&t.push({title:ee(e.service),uri:"__source__",view:"source"}),t.push({title:e.title,uri:e.uri,view:"album-detail",service:e.service||""})),void this._enterAlbumDetail({title:e.title,artist:e.artist||"",albumart:e.albumart||"",uri:e.uri,service:e.service||"",searchTrail:t})}if("artist"===i){let t;return(this._searchQuery||this._searchTrail.length>0)&&(t=this._searchTrail.length>0?[...this._searchTrail]:[{title:`Search "${this._searchQuery}"`,uri:"__search__",view:"search"}],1===t.length&&e.service&&t.push({title:ee(e.service),uri:"__source__",view:"source"}),t.push({title:e.title,uri:e.uri,view:"artist-detail",service:e.service||""})),void this._enterArtistDetail({artist:e.title||"",uri:e.uri,service:e.service||"",searchTrail:t})}0===this._searchTrail.length&&(this._searchQuery="",this._searchResults=null),this._browseTo(e.uri,e.title||"Browse")}}async _onBrowseItemPlay(t){const e=t.detail;try{await this._callService("replace_and_play",{uri:e.uri,title:e.title||"",service:e.service||"",artist:e.artist||"",albumart:e.albumart||""}),this._refreshQueue()}catch(t){console.error("[volumio-panel] Play failed:",t)}}async _onTrackPlay(t){const e=t.detail,i=this._getDefaultClickAction();try{"add_to_queue"===i?(await this._callService("queue_add",{uri:e.uri,title:e.title||"",service:e.service||"",artist:e.artist||"",album:e.album||"",albumart:e.albumart||""}),this._refreshQueue(),this._showToast("Added to queue")):(await this._callService("replace_and_play",{uri:e.uri,title:e.title||"",service:e.service||"",artist:e.artist||"",album:e.album||"",albumart:e.albumart||"",type:e.type||"song"}),this._refreshQueue())}catch(t){console.error("[volumio-panel] Track play failed:",t)}}async _onAlbumPlay(t){const{uri:e}=t.detail;try{await this._callService("replace_and_play",{uri:e,service:this._browseContext?.service||""}),this._refreshQueue()}catch(t){console.error("[volumio-panel] Album play failed:",t)}}async _onAlbumAddQueue(t){const{uri:e}=t.detail,i=(this._browseItems||[]).filter(t=>t&&("song"===t.type||"track"===t.type));if(0!==i.length)try{for(const t of i)await this._callService("queue_add",{uri:t.uri,title:t.title||"",service:t.service||this._browseContext?.service||"",artist:t.artist||"",album:t.album||this._browseContext?.title||"",albumart:t.albumart||""});this._refreshQueue(),this._showToast(`Added ${i.length} track${1===i.length?"":"s"} to queue`)}catch(t){console.error("[volumio-panel] Album queue add failed:",t),this._showToast("Failed to add album")}else try{await this._callService("queue_add",{uri:e}),this._refreshQueue(),this._showToast("Added to queue")}catch(t){console.error("[volumio-panel] Album queue add failed:",t),this._showToast("Failed to add album")}}async _onQueueItemClick(t){try{await this._callService("queue_play_index",{index:t})}catch(t){console.error("[volumio-panel] Queue play index failed:",t)}}_onQueueClearClick(){this._queueConfirmClear=!0}async _onQueueClear(){this._queueConfirmClear=!1;const t=this._adapter.getState(),e="playing"===t.state||"paused"===t.state;try{if(e&&t.uri){const e={uri:t.uri,title:t.title,artist:t.artist,album:t.album,service:t.source};await this._callService("queue_clear",{}),await this._callService("replace_and_play",e)}else await this._callService("queue_clear",{});this._refreshQueue(),this._showToast("Queue cleared")}catch(t){console.error("[volumio-panel] Queue clear failed:",t)}}async _onAddItemToQueue(t){const e=t.detail;try{await this._callService("queue_add",{uri:e.uri,title:e.title||"",service:e.service||"",artist:e.artist||"",album:e.album||"",albumart:e.albumart||""}),this._refreshQueue(),this._showToast("Added to queue")}catch(t){console.error("[volumio-panel] Add to queue failed:",t)}}async _refreshQueue(){if(this._adapter.ready)try{const t=await this._adapter.call("queue_get");t?.response?.queue&&(this._queue=t.response.queue.filter(Boolean))}catch(t){}}async _onQueueRemove(t,e){t.stopPropagation();const i=this._queue[e];try{await this._callService("queue_remove",{index:e}),this._refreshQueue(),this._showToast("Removed from queue","undo_queue_remove"),this._toastUndoData={item:i,index:e}}catch(t){console.error("[volumio-panel] Queue remove failed:",t)}}_onQueueContextMenu(t,e,i){t.preventDefault(),t.stopPropagation(),this._ctxTarget={...e,index:i,context:"queue"},this._ctxItems=this._buildContextItems("queue"),this._ctxX=t.clientX,this._ctxY=t.clientY,this._ctxOpen=!0}_onQueueSaveStart(){0!==this._queue.length&&(this._queueSaveName="",this._queueSaveOpen=!0,this.updateComplete.then(()=>{const t=this.shadowRoot?.querySelector(".save-dialog input");t&&t.focus()}))}async _onQueueSaveConfirm(){const t=this._queueSaveName.trim();if(t){this._queueSaveOpen=!1;try{await this._callService("save_queue_to_playlist",{name:t}),this._showToast(`Saved as playlist "${t}"`)}catch(t){console.error("[volumio-panel] Save playlist failed:",t),this._showToast("Failed to save playlist")}}}_onDragStart(t,e){t.preventDefault(),t.stopPropagation(),this._dragIndex=e,this._dragOverIndex=-1;const i=t=>{const e=this.shadowRoot?.querySelector(".queue-list");if(!e)return;const i=e.querySelectorAll(".queue-item");let s=-1,a=1/0;i.forEach((e,i)=>{const o=e.getBoundingClientRect(),r=o.top+o.height/2,n=Math.abs((t.clientY||t.touches?.[0]?.clientY||0)-r);n<a&&(a=n,s=i)}),s!==this._dragOverIndex&&(this._dragOverIndex=s)},s=async()=>{document.removeEventListener("pointermove",i),document.removeEventListener("pointerup",s),document.removeEventListener("pointercancel",s);const t=this._dragIndex,e=this._dragOverIndex;if(this._dragIndex=-1,this._dragOverIndex=-1,t>=0&&e>=0&&t!==e)try{await this._callService("queue_move",{from_index:t,to_index:e}),this._refreshQueue()}catch(t){console.error("[volumio-panel] Queue move failed:",t)}};document.addEventListener("pointermove",i),document.addEventListener("pointerup",s),document.addEventListener("pointercancel",s)}async _onContextMenuRequest(t){t.stopPropagation();const e=t.detail;this._ctxTarget=e,this._ctxItems=this._buildContextItems(e.context||"track"),this._ctxX=e.x,this._ctxY=e.y,this._ctxOpen=!0;try{const t=await this._callService("playlist_list",{}),e=t?.response?.playlists||[];this._ctxPlaylists=e.map(t=>({key:t,label:t}))}catch{this._ctxPlaylists=[]}}_buildContextItems(t){const e=[];return"album"===t?(e.push({key:"play",label:"Play",icon:"mdi:play"}),e.push({key:"play_next",label:"Play Next",icon:"mdi:skip-next"}),e.push({key:"add_to_queue",label:"Add to Queue",icon:"mdi:playlist-plus"}),e.push({separator:!0}),e.push({key:"add_to_favorites",label:"Add to Favorites",icon:"mdi:heart-outline"}),e.push({key:"add_to_playlist",label:"Add to Playlist",icon:"mdi:playlist-music",submenu:!0}),e.push({separator:!0}),e.push({key:"go_to_album",label:"Go to Album",icon:"mdi:album"}),e.push({key:"go_to_artist",label:"Go to Artist",icon:"mdi:account-music"})):"album_card"===t?(e.push({key:"play",label:"Play",icon:"mdi:play"}),e.push({separator:!0}),e.push({key:"add_to_favorites",label:"Add to Favorites",icon:"mdi:heart-outline"}),e.push({key:"add_to_playlist",label:"Add to Playlist",icon:"mdi:playlist-music",submenu:!0}),e.push({separator:!0}),e.push({key:"go_to_album",label:"Go to Album",icon:"mdi:album"}),e.push({key:"go_to_artist",label:"Go to Artist",icon:"mdi:account-music"})):"queue"===t?(e.push({key:"play",label:"Play Now",icon:"mdi:play"}),e.push({key:"play_next",label:"Play Next",icon:"mdi:skip-next"}),e.push({key:"add_to_queue",label:"Add to Queue",icon:"mdi:playlist-plus"}),e.push({separator:!0}),e.push({key:"add_to_favorites",label:"Add to Favorites",icon:"mdi:heart-outline"}),e.push({key:"add_to_playlist",label:"Add to Playlist",icon:"mdi:playlist-music",submenu:!0}),e.push({separator:!0}),e.push({key:"go_to_album",label:"Go to Album",icon:"mdi:album"}),e.push({key:"go_to_artist",label:"Go to Artist",icon:"mdi:account-music"}),e.push({separator:!0}),e.push({key:"remove",label:"Remove",icon:"mdi:close"})):"playlist"===t?(e.push({key:"play",label:"Play",icon:"mdi:play"}),e.push({key:"enqueue",label:"Enqueue",icon:"mdi:playlist-plus"}),e.push({separator:!0}),e.push({key:"delete_playlist",label:"Delete Playlist",icon:"mdi:delete-outline"})):"favorite"===t?(e.push({key:"play",label:"Play Now",icon:"mdi:play"}),e.push({key:"add_to_queue",label:"Add to Queue",icon:"mdi:playlist-plus"}),e.push({separator:!0}),e.push({key:"remove_favorite",label:"Remove from Favorites",icon:"mdi:heart-off"}),e.push({separator:!0}),e.push({key:"go_to_album",label:"Go to Album",icon:"mdi:album"}),e.push({key:"go_to_artist",label:"Go to Artist",icon:"mdi:account-music"})):"history"===t?(e.push({key:"play",label:"Play Now",icon:"mdi:play"}),e.push({key:"add_to_queue",label:"Add to Queue",icon:"mdi:playlist-plus"}),e.push({separator:!0}),e.push({key:"add_to_favorites",label:"Add to Favorites",icon:"mdi:heart-outline"}),e.push({key:"add_to_playlist",label:"Add to Playlist",icon:"mdi:playlist-music",submenu:!0}),e.push({separator:!0}),e.push({key:"go_to_album",label:"Go to Album",icon:"mdi:album"}),e.push({key:"go_to_artist",label:"Go to Artist",icon:"mdi:account-music"})):(e.push({key:"play",label:"Play Now",icon:"mdi:play"}),e.push({key:"play_next",label:"Play Next",icon:"mdi:skip-next"}),e.push({key:"add_to_queue",label:"Add to Queue",icon:"mdi:playlist-plus"}),e.push({separator:!0}),e.push({key:"add_to_favorites",label:"Add to Favorites",icon:"mdi:heart-outline"}),e.push({key:"add_to_playlist",label:"Add to Playlist",icon:"mdi:playlist-music",submenu:!0}),e.push({separator:!0}),e.push({key:"go_to_album",label:"Go to Album",icon:"mdi:album"}),e.push({key:"go_to_artist",label:"Go to Artist",icon:"mdi:account-music"})),e}async _onContextAction(t){const{action:e,playlist:i}=t.detail,s=this._ctxTarget;if(s)try{switch(e){case"play":"playlist"===s.context&&s.title?(await this._callService("playlist_play",{name:s.title}),this._refreshQueue()):"queue"===s.context&&null!=s.index?await this._callService("queue_play_index",{index:s.index}):(await this._callService("replace_and_play",{uri:s.uri,title:s.title||"",service:s.service||"",artist:s.artist||"",album:s.album||"",albumart:s.albumart||"",type:s.type||"song"}),this._refreshQueue());break;case"play_next":{const t="album"===s.context||"album"===s.type,e=t?(this._browseItems||[]).filter(t=>t&&("song"===t.type||"track"===t.type)):[s];if(0===e.length)break;const i=this._adapter.getState().queuePosition??-1,a=this._queue.length;for(const i of e)await this._callService("queue_add",{uri:i.uri,title:i.title||"",service:i.service||this._browseContext?.service||"",artist:i.artist||"",album:i.album||(t?this._browseContext?.title:"")||"",albumart:i.albumart||""});let o=i+1;for(let t=0;t<e.length;t++){const e=a+t;e>o&&await this._callService("queue_move",{from_index:e,to_index:o}),o+=1}this._refreshQueue(),this._showToast(1===e.length?"Playing next":`Queued ${e.length} tracks next`);break}case"add_to_queue":await this._callService("queue_add",{uri:s.uri,title:s.title||"",service:s.service||"",artist:s.artist||"",album:s.album||"",albumart:s.albumart||""}),this._refreshQueue(),this._showToast("Added to queue");break;case"add_to_favorites":await this._callService("favorites_add",{uri:s.uri,title:s.title||"",service:s.service||""}),this._showToast("Added to favorites");break;case"add_to_playlist":if("__new__"===i){const t=prompt("New playlist name:");t&&(await this._callService("playlist_create",{name:t}),await this._callService("playlist_add_track",{name:t,uri:s.uri,service:s.service||""}),this._showToast(`Added to "${t}"`))}else i&&(await this._callService("playlist_add_track",{name:i,uri:s.uri,service:s.service||""}),this._showToast(`Added to "${i}"`));break;case"go_to_album":if(s.album||s.title||s.albumUri){let t="";("album"===s.context||"album_card"===s.context||"album"===s.type)&&s.uri?t=s.uri:s.albumUri?t=s.albumUri:"mpd"===s.service&&s.artist&&s.album&&(t=`albums://${encodeURIComponent(s.artist)}/${encodeURIComponent(s.album)}`);const e=s.album||s.title||"",i=s.service||"";let a;this._searchQuery||this._searchTrail.length>0?(a=this._searchTrail.length>0?[...this._searchTrail]:[{title:`Search "${this._searchQuery}"`,uri:"__search__",view:"search"}],1===a.length&&i&&a.push({title:ee(i),uri:"__source__",view:"source"}),a.push({title:e,uri:t,view:"album-detail",service:i})):(a=[],"album_card"===s.context&&t&&(this._browseStack=[...this._browseStack,{uri:t,title:e}])),this._enterAlbumDetail({title:e,artist:s.artist||"",albumart:s.albumart||"",uri:t,service:i,searchTrail:a,skipLoad:!t})}break;case"go_to_artist":if(s.artist){const t=s.service||"",e=`globalUriArtist/${s.artist}`,i=this._activeView,a="now-playing"===i?"Now Playing":"Browse";this._enterArtistDetail({artist:s.artist,uri:e,service:t,searchTrail:[{title:a,uri:"__origin__",view:"now-playing"===i?"now-playing":"browse"},{title:s.artist,uri:e,view:"artist-detail",service:t}]})}break;case"remove":"queue"===s.context&&null!=s.index&&(await this._callService("queue_remove",{index:s.index}),this._refreshQueue(),this._showToast("Removed from queue","undo_queue_remove"),this._toastUndoData={item:s,index:s.index});break;case"enqueue":"playlist"===s.type&&s.title&&(await this._callService("playlist_enqueue",{name:s.title}),this._refreshQueue(),this._showToast(`Playlist "${s.title}" added to queue`));break;case"delete_playlist":s.title&&(await this._callService("playlist_delete",{name:s.title}),this._showToast(`Playlist "${s.title}" deleted`),"playlists"===this._activeView&&this._loadPlaylists());break;case"remove_favorite":await this._callService("favorites_remove",{uri:s.uri,service:s.service||void 0}),this._showToast("Removed from favorites"),"favorites"===this._activeView&&this._loadFavorites(),setTimeout(()=>this._checkFavorite(),500)}}catch(t){console.error("[volumio-panel] Context action failed:",t),this._showToast("Action failed")}}_showToast(t,e=null){this._toastMessage=t,this._toastUndo=e,this._toastOpen=!0}async _onToastUndo(t){const{action:e}=t.detail;if("undo_queue_remove"===e&&this._toastUndoData){const{item:t,index:e}=this._toastUndoData;try{const i=this._queue.length;await this._callService("queue_add",{uri:t.uri,title:t.title||t.name||"",service:t.service||"",artist:t.artist||"",album:t.album||"",albumart:t.albumart||""}),e<i&&await this._callService("queue_move",{from_index:i,to_index:e}),this._refreshQueue()}catch(t){console.error("[volumio-panel] Undo failed:",t)}}this._toastUndoData=null}_getDefaultClickAction(){return this._settingClickAction}_onBreadcrumbClick(t){const{index:e}=t.detail;this._browseStack=this._browseStack.slice(0,e+1);const i=this._browseStack[this._browseStack.length-1];"browse"!==this._activeView&&(this._activeView="browse"),this._loadBrowseItems(i.uri)}async _onSearch(t){const{query:e}=t.detail;if(e&&!(e.length<2)&&this._adapter.ready){this._searchQuery||this._pushHistorySentinel(),this._searchQuery=e,this._searchLoading=!0,this._searchResults=null,this._searchTrail=[],"album-detail"!==this._activeView&&"artist-detail"!==this._activeView||(this._activeView="browse");try{const t=await this._callService("search",{query:e});if(this._searchQuery!==e)return;this._searchResults=t?.response||t||null}catch(t){console.error("[volumio-panel] Search failed:",t),this._searchQuery===e&&(this._searchResults=null)}finally{this._searchQuery===e&&(this._searchLoading=!1)}}}_onSearchClear(){this._sentinelArmed=!1,this._searchQuery="",this._searchResults=null,this._searchLoading=!1,this._searchTrail=[]}_onSearchBreadcrumbClick(t){const{index:e}=t.detail,i=this._searchTrail[e];if(i)if("now-playing"===i.view)this._activeView="now-playing",this._searchTrail=[];else if("search"===i.view||"browse"===i.view||0===e)this._activeView="browse",this._searchTrail=[];else if("artist-detail"===i.view)this._enterArtistDetail({artist:i.title,uri:i.uri,service:i.service||"",searchTrail:this._searchTrail.slice(0,e+1),pushHistory:!1});else if("album-detail"===i.view){const t=this._browseContext?.artist||"";this._enterAlbumDetail({title:i.title,artist:t,albumart:this._browseContext?.albumart||"",uri:i.uri,service:i.service||"",searchTrail:this._searchTrail.slice(0,e+1),pushHistory:!1})}}async _onCommand(t){const{command:e,value:i}=t.detail;if("unavailable"!==this._adapter.getState().state)try{switch(e){case"play_pause":await this._adapter.playPause();break;case"next":await this._adapter.next();break;case"prev":await this._adapter.prev();break;case"seek":await this._adapter.seek(i);break;case"volume_set":await this._adapter.setVolume(i);break;case"mute_toggle":await this._adapter.toggleMute();break;case"shuffle_set":await this._adapter.setShuffle(i);break;case"repeat_set":await this._adapter.setRepeat(i);break;default:console.warn("[volumio-panel] Unknown command:",e)}}catch(t){console.error("[volumio-panel] Command failed:",e,t)}}async _checkFavorite(){if(this._adapter.ready)try{const t=await this._adapter.call("favorites_list"),e=t?.response?.items||[];this._favoritesCache=e;const i=this._adapter.getState();this._isFavorite=!(!i.uri||!e.some(t=>t?.uri===i.uri))}catch(t){console.error("[volumio-panel] favorites_list failed:",t)}}async _onToggleFavorite(){const t=this._adapter.getState();if(!this._adapter.ready||!t.uri)return;const e=this._isFavorite;this._isFavorite=!e;try{e?await this._callService("favorites_remove",{uri:t.uri,service:t.source}):await this._callService("favorites_add",{uri:t.uri,title:t.title,service:t.source}),setTimeout(()=>this._checkFavorite(),500)}catch(t){console.error("[volumio-panel] Favorite toggle failed:",t),this._isFavorite=e}}_onKeyDown(t){const e=t.composedPath?.()?.[0]||t.target;if("INPUT"===e.tagName||"TEXTAREA"===e.tagName)return;if(!this.isConnected)return;const i=this._adapter.getState();if("unavailable"!==i.state)switch(t.key){case" ":t.preventDefault(),this._onCommand({detail:{command:"play_pause"}});break;case"ArrowRight":if(t.shiftKey)t.preventDefault(),this._onCommand({detail:{command:"next"}});else{t.preventDefault();const e=(i.position||0)+10;this._onCommand({detail:{command:"seek",value:e}})}break;case"ArrowLeft":if(t.shiftKey)t.preventDefault(),this._onCommand({detail:{command:"prev"}});else{t.preventDefault();const e=Math.max(0,(i.position||0)-10);this._onCommand({detail:{command:"seek",value:e}})}break;case"ArrowUp":t.preventDefault();{const t=Math.min(100,i.volume+2);this._onCommand({detail:{command:"volume_set",value:t}})}break;case"ArrowDown":t.preventDefault();{const t=Math.max(0,i.volume-2);this._onCommand({detail:{command:"volume_set",value:t}})}break;case"m":case"M":this._onCommand({detail:{command:"mute_toggle"}});break;case"s":case"S":this._onCommand({detail:{command:"shuffle_set",value:!i.shuffle}});break;case"r":case"R":{const t=i.repeat,e="off"===t?"all":"all"===t?"one":"off";this._onCommand({detail:{command:"repeat_set",value:e}})}break;case"/":t.preventDefault(),this.shadowRoot?.querySelector("volumio-top-bar")?.shadowRoot?.querySelector(".search-field input")?.focus();break;case"Escape":this._searchQuery&&this._onSearchClear(),this._showNavFlyout=!1}}});
