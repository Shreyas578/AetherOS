"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { AgentCard } from "@/components/AgentCard";
import { ChatBox } from "@/components/ChatBox";

export default function OverviewPage() {
  const [stats, setStats] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const url = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://127.0.0.1:4001";
        const token = "aetheros_orchestrator_secret_key_change_me";
        
        const [statsRes, agentsRes] = await Promise.all([
          axios.get(`${url}/stats`, { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 }),
          axios.get(`${url}/agents`, { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 })
        ]);
        
        setStats(statsRes.data);
        setAgents(agentsRes.data.agents);
        setError(false);
      } catch (err) {
        console.error("Failed to fetch dashboard data", err);
        setError(true);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  if (error && !stats) {
    return (
      <div className="h-[80vh] flex flex-col items-center justify-center text-muted-foreground space-y-4">
        <div className="text-4xl">⚠️</div>
        <p className="text-lg font-semibold text-white">Orchestrator Offline</p>
        <p className="text-sm">Make sure the orchestrator is running:</p>
        <code className="bg-white/5 border border-white/10 rounded px-4 py-2 text-xs text-primary">
          npx ts-node-dev --respawn orchestrator/src/index.ts
        </code>
        <p className="text-xs text-muted-foreground mt-2">Retrying every 5 seconds...</p>
      </div>
    );
  }

  if (!stats) {
    return <div className="animate-pulse h-[80vh] flex items-center justify-center text-muted-foreground">Loading AetherOS Network...</div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Hero Section */}
      <div className="glass-panel p-8 relative overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/20 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-secondary/20 rounded-full blur-[100px] pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between">
          <div>
            <h1 className="text-4xl md:text-5xl font-outfit font-bold mb-4">
              Dual Cascade <span className="gradient-text">Ecosystem</span>
            </h1>
            <p className="text-muted-foreground max-w-xl text-lg">
              Autonomous agents interacting on the Pharos network. Complete local-first ML pipeline with risk gating and on-chain reputation.
            </p>
          </div>
          <div className="mt-8 md:mt-0 grid grid-cols-2 gap-4">
            <div className="bg-black/30 border border-white/10 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-white">{stats.totalEvents}</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1">Actions</p>
            </div>
            <div className="bg-black/30 border border-white/10 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-white">{(stats.successRate * 100).toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1">Success Rate</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-2xl font-outfit font-semibold border-b border-white/10 pb-2">Active Agents</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-2xl font-outfit font-semibold border-b border-white/10 pb-2">Orchestrator</h2>
          <ChatBox />
        </div>
      </div>
    </div>
  );
}
