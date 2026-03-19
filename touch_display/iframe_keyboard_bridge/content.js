// Volumio Iframe Keyboard Bridge
// Enables onscreen keyboard to work with inputs inside iframes

(function() {
  'use strict';
  
  // Create input element for keyboard trigger that can receive keystrokes
  const triggerInput = document.createElement('input');
  triggerInput.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
  triggerInput.setAttribute('aria-hidden', 'true');
  triggerInput.setAttribute('tabindex', '-1');
  triggerInput.setAttribute('autocomplete', 'off');
  triggerInput.setAttribute('autocorrect', 'off');
  triggerInput.setAttribute('autocapitalize', 'off');
  triggerInput.setAttribute('spellcheck', 'false');
  
  let keyboardActive = false;
  let activeIframe = null;
  
  // Wait for body to be ready
  const injectTrigger = () => {
    if (document.body) {
      document.body.appendChild(triggerInput);
      console.log('[Volumio] Keyboard bridge initialized');
    } else {
      setTimeout(injectTrigger, 100);
    }
  };
  
  injectTrigger();
  
  // Relay input events to iframe
  triggerInput.addEventListener('input', (e) => {
    if (keyboardActive && activeIframe) {
      const value = triggerInput.value;
      
      // Send keystroke to iframe
      activeIframe.postMessage({
        type: 'volumio-keystroke',
        action: 'input',
        value: value
      }, '*');
      
      // Clear trigger input for next keystroke
      triggerInput.value = '';
    }
  });
  
  // Listen for messages from iframes
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'volumio-input-focus') {
      if (event.data.action === 'show-keyboard') {
        console.log('[Volumio] Showing keyboard for iframe input');
        keyboardActive = true;
        activeIframe = event.source;
        
        // Clear any previous value
        triggerInput.value = '';
        
        // Focus trigger to activate keyboard
        triggerInput.focus();
        
        // Dispatch custom event
        document.dispatchEvent(new CustomEvent('volumio-keyboard-show', {
          bubbles: true,
          detail: { source: 'iframe' }
        }));
        
      } else if (event.data.action === 'hide-keyboard') {
        console.log('[Volumio] Hiding keyboard for iframe input');
        keyboardActive = false;
        activeIframe = null;
        
        // Blur trigger element
        triggerInput.blur();
        triggerInput.value = '';
        
        // Dispatch hide event
        document.dispatchEvent(new CustomEvent('volumio-keyboard-hide', {
          bubbles: true,
          detail: { source: 'iframe' }
        }));
      }
    }
  }, false);
  
  console.log('[Volumio] Iframe keyboard bridge loaded');
})();
