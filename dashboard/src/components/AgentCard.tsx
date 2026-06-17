"use client";

import { motion } from "framer-motion";
import { Activity, ShieldCheck, TrendingUp, Users } from "lucide-react";
import Link from "next/link";
import { cn, formatPhrs } from "@/lib/utils";

const iconMap: Record<string, React.ReactNode> = {
  TRADING: <TrendingUp className="h-5 w-5 text-green-400" />,
  SOCIAL: <Users className="h-5 w-5 text-blue-400" />,
  GOVERNANCE: <ShieldCheck className="h-5 w-5 text-purple-400" />,
  BUDGET_ALLOCATOR: <Activity className="h-5 w-5 text-orange-400" />,
};

interface AgentCardProps {
  id: number;
  name: string;
  type: string;
  status: string;
  budget_phrs: number;
  reputation_score: number;
}

export function AgentCard({ agent }: { agent: AgentCardProps }) {
  const isRunning = agent.status === "running";

  return (
    <Link href={`/agents/${agent.name}`}>
      <motion.div
        whileHover={{ y: -5, scale: 1.02 }}
        className="glass-panel p-6 h-full flex flex-col justify-between cursor-pointer group hover:border-primary/50 transition-colors"
      >
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-white/5 border border-white/10 group-hover:bg-primary/20 transition-colors">
              {iconMap[agent.type] || <Activity className="h-5 w-5 text-gray-400" />}
            </div>
            <div>
              <h3 className="font-outfit font-semibold text-lg">{agent.name}</h3>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{agent.type}</p>
            </div>
          </div>
          <div className={cn(
            "px-2.5 py-0.5 rounded-full text-xs font-medium border",
            isRunning 
              ? "bg-green-500/10 text-green-400 border-green-500/20" 
              : "bg-red-500/10 text-red-400 border-red-500/20"
          )}>
            {isRunning ? "Active" : "Stopped"}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="bg-black/20 rounded-lg p-3 border border-white/5">
            <p className="text-xs text-muted-foreground mb-1">Reputation Score</p>
            <div className="flex items-end space-x-2">
              <span className="text-2xl font-bold text-white">{agent.reputation_score}</span>
              <span className="text-xs text-muted-foreground mb-1">/ 100</span>
            </div>
          </div>
          <div className="bg-black/20 rounded-lg p-3 border border-white/5">
            <p className="text-xs text-muted-foreground mb-1">Budget Allocation</p>
            <div className="flex items-end space-x-2">
              <span className="text-xl font-bold text-white truncate">{formatPhrs(agent.budget_phrs)}</span>
            </div>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
