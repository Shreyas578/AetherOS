"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Bot, User } from "lucide-react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";

export function ChatBox() {
  const [messages, setMessages] = useState<{ role: "user" | "bot"; content: string; latency?: number }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const url = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://127.0.0.1:4001";
      // We pass a dummy token since we removed auth requirement or use default API key
      const token = "aetheros_orchestrator_secret_key_change_me"; 
      
      const res = await axios.post(
        `${url}/chat`,
        { query: userMsg },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 60000 }
      );
      
      setMessages(prev => [...prev, { 
        role: "bot", 
        content: res.data.answer,
        latency: res.data.latencyMs 
      }]);
    } catch (err: any) {
      const msg = err.code === 'ERR_NETWORK' || err.message === 'Network Error'
        ? 'Cannot reach orchestrator. Make sure it is running on port 4000.'
        : `Error: ${err.response?.data?.error || err.message}`;
      setMessages(prev => [...prev, { role: "bot", content: msg }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel flex flex-col h-[500px] border border-white/10 rounded-xl overflow-hidden">
      <div className="bg-white/5 p-4 border-b border-white/10">
        <h3 className="font-outfit font-semibold flex items-center">
          <Bot className="h-5 w-5 mr-2 text-primary" />
          Orchestrator Assistant (Mistral:7b)
        </h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground mt-20">
            Ask me about recent agent activity... <br/>
            (e.g., "Why didn't the trading agent buy ETH today?")
          </div>
        )}
        
        <AnimatePresence>
          {messages.map((m, i) => (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={i} 
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={`max-w-[80%] rounded-2xl p-3 flex items-start space-x-3 ${
                m.role === "user" 
                  ? "bg-primary/20 border border-primary/30 text-white rounded-tr-sm" 
                  : "bg-white/5 border border-white/10 text-gray-200 rounded-tl-sm"
              }`}>
                {m.role === "bot" && <Bot className="h-5 w-5 mt-0.5 text-primary shrink-0" />}
                <div>
                  <div className="text-sm">{m.content}</div>
                  {m.latency && (
                    <div className="text-[10px] text-muted-foreground mt-1 text-right">
                      {m.latency}ms
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
          {loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
               <div className="bg-white/5 border border-white/10 text-gray-200 rounded-2xl rounded-tl-sm p-4 flex items-center space-x-2">
                 <Bot className="h-5 w-5 text-primary animate-pulse shrink-0" />
                 <span className="flex space-x-1">
                   <span className="animate-bounce inline-block w-1 h-1 bg-gray-400 rounded-full"></span>
                   <span className="animate-bounce inline-block w-1 h-1 bg-gray-400 rounded-full" style={{ animationDelay: "0.2s" }}></span>
                   <span className="animate-bounce inline-block w-1 h-1 bg-gray-400 rounded-full" style={{ animationDelay: "0.4s" }}></span>
                 </span>
               </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={endRef} />
      </div>

      <div className="p-4 bg-black/20 border-t border-white/10">
        <form onSubmit={sendMessage} className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Query agent events..."
            disabled={loading}
            className="w-full bg-white/5 border border-white/10 rounded-full py-3 pl-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-white placeholder-gray-500"
          />
          <button 
            type="submit" 
            disabled={loading || !input.trim()}
            className="absolute right-2 top-2 p-1.5 bg-primary rounded-full text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
