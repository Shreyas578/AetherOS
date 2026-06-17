"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReasoningChainProps {
  event: any;
}

export function ReasoningChain({ event }: ReasoningChainProps) {
  const [isOpen, setIsOpen] = useState(false);
  const explorerUrl = process.env.NEXT_PUBLIC_PHAROS_EXPLORER || "https://pharosscan.xyz";

  // Parse lines from reasoning_text
  const lines = event.reasoning_text ? event.reasoning_text.split('\n') : [];
  
  return (
    <div className="glass-panel overflow-hidden mb-4 border border-white/5">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors text-left"
      >
        <div className="flex items-center space-x-4">
          <span className={cn(
            "px-2.5 py-1 rounded text-xs font-semibold uppercase tracking-wider",
            event.success ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"
          )}>
            {event.event_type.replace('_', ' ')}
          </span>
          <span className="text-sm text-gray-300">
            {new Date(event.timestamp).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center space-x-3">
          {event.tx_hash && (
            <a 
              href={`${explorerUrl}/tx/${event.tx_hash}`} 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center text-xs text-primary hover:text-secondary transition-colors"
            >
              <LinkIcon className="h-3 w-3 mr-1" />
              {event.tx_hash.slice(0, 8)}...
            </a>
          )}
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/10 p-4 bg-black/40 text-sm font-mono text-gray-300 space-y-2 overflow-x-auto"
          >
            {lines.map((line: string, i: number) => {
              // Color code based on content
              let color = "text-gray-300";
              if (line.includes("BUY") || line.includes("APPROVED") || line.includes("positive")) color = "text-green-400";
              else if (line.includes("SELL") || line.includes("BLOCKED") || line.includes("negative") || line.includes("ERROR")) color = "text-red-400";
              else if (line.includes("HOLD") || line.includes("neutral")) color = "text-yellow-400";
              
              return (
                <div key={i} className="flex">
                  <span className="text-gray-600 mr-4 select-none">{String(i + 1).padStart(2, '0')}</span>
                  <span className={color}>{line}</span>
                </div>
              );
            })}

            {event.inference_latency_ms && (
              <div className="mt-4 pt-2 border-t border-white/10 text-xs text-gray-500 flex justify-between">
                <span>Inference Latency: {event.inference_latency_ms}ms</span>
                <span>Cache Hit: {event.cache_hit ? 'Yes' : 'No'}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
