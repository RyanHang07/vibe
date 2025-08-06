"use client";

import { useState, useEffect } from 'react';
import { Eye, EyeOff, Key, Shield, AlertCircle } from 'lucide-react';

export default function ApiKeyInput({ onApiKeyChange, placeholder = "Enter your OpenAI API key for Inngest agents..." }) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isValid, setIsValid] = useState(null);
  const [isFocused, setIsFocused] = useState(false);

  // Validate API key format (OpenAI keys start with 'sk-' and are typically 51 characters)
  const validateApiKey = (key) => {
    const trimmedKey = key.trim();
    if (!trimmedKey) return null;
    return trimmedKey.startsWith('sk-') && trimmedKey.length >= 48;
  };

  useEffect(() => {
    const valid = validateApiKey(apiKey);
    setIsValid(valid);
    
    // Call the parent callback with the API key
    if (onApiKeyChange) {
      onApiKeyChange(valid ? apiKey.trim() : null);
    }
  }, [apiKey, onApiKeyChange]);

  const handleInputChange = (e) => {
    setApiKey(e.target.value);
  };

  const toggleShowKey = () => {
    setShowKey(!showKey);
  };

  const clearKey = () => {
    setApiKey('');
    setShowKey(false);
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="mb-4">
        <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
          <Key className="w-4 h-4" />
          OpenAI API Key
        </label>
        
        <div className={`relative rounded-lg border-2 transition-all duration-200 ${
          isFocused 
            ? 'border-blue-500 ring-2 ring-blue-500/20' 
            : isValid === true 
              ? 'border-green-500' 
              : isValid === false 
                ? 'border-red-500' 
                : 'border-gray-300 hover:border-gray-400'
        }`}>
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={handleInputChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            className="w-full px-4 py-3 pr-24 rounded-lg border-0 focus:outline-none focus:ring-0 font-mono text-sm bg-transparent"
          />
          
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {apiKey && (
              <button
                type="button"
                onClick={clearKey}
                className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors rounded"
                title="Clear API key"
              >
                <AlertCircle className="w-4 h-4" />
              </button>
            )}
            
            {apiKey && (
              <button
                type="button"
                onClick={toggleShowKey}
                className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors rounded"
                title={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Status indicator */}
      {apiKey && (
        <div className={`flex items-center gap-2 text-sm ${
          isValid ? 'text-green-600' : 'text-red-600'
        }`}>
          <div className={`w-2 h-2 rounded-full ${
            isValid ? 'bg-green-500' : 'bg-red-500'
          }`} />
          {isValid ? 'Valid API key format' : 'Invalid API key format'}
        </div>
      )}

      {/* Security notice */}
      <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
        <div className="flex items-start gap-2">
          <Shield className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Your API key is secure</p>
            <p className="text-blue-600">
              Your API key is stored temporarily in your browser's memory and never sent to our servers. 
              It will be cleared when you refresh or close the page.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}