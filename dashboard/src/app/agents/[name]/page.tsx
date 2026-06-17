"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useParams } from "next/navigation";
import { ReasoningChain } from "@/components/ReasoningChain";
import {
  PriceHistoryChart,
  DecisionChart,
  RiskScoreChart,
  SentimentChart,
  RiskRadarChart,
  ForecastAccuracyChart,
} from "@/components/TradingCharts";
import { Activity, ServerCrash, TrendingUp, BarChart2 } from "lucide-react";

const ORC_URL   = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://127.0.0.1:4001";
const ORC_TOKEN = "aetheros_orchestrator_secret_key_change_me";
const HEADERS   = { Authorization: `Bearer ${ORC_TOKEN}` };

export default function AgentDetailPage() {
  const params = useParams();
  const name = params.name as string;
  const [events, setEvents]     = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState<"charts" | "events">("charts");

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await axios.get(
          `${ORC_URL}/events?agentName=${name}&limit=100`,
          { headers: HEADERS }
        );
        setEvents(res.data.events);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, name === "trading-agent" ? 15000 : 30000);
    return () => clearInterval(interval);
  }, [name]);

  const isTradingAgent = name === "trading-agent";

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Activity className="animate-spin text-primary h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in space-y-6">
      {/* Header */}
      <div className="glass-panel p-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-outfit font-bold capitalize">
            {name.replace(/-/g, " ")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isTradingAgent
              ? `Live multi-token trading decisions — ${new Set(events.map(e => e.output_json?.token).filter(Boolean)).size} tokens active`
              : "Live decision history and reasoning chains."}
          </p>
        </div>
        {isTradingAgent && (
          <div className="flex gap-2">
            {(["charts", "events"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  activeTab === tab
                    ? "bg-primary text-white"
                    : "bg-white/5 text-muted-foreground hover:bg-white/10"
                }`}
              >
                {tab === "charts" ? <BarChart2 className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>

      {events.length === 0 ? (
        <div className="glass-panel p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
          <ServerCrash className="h-12 w-12 mb-4 opacity-50" />
          <p>No events recorded yet — agent is starting up.</p>
        </div>
      ) : isTradingAgent && activeTab === "charts" ? (
        /* ── Trading Charts View ── */
        <div className="space-y-6">
          {/* Stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              {
                label: "Total Cycles",
                value: events.filter(e => e.event_type === "TRADING_CYCLE").length,
              },
              {
                label: "Tokens Tracked",
                value: new Set(events.map(e => e.output_json?.token).filter(Boolean)).size,
              },
              {
                label: "BUY Decisions",
                value: events.filter(e => e.output_json?.decision === "BUY").length,
              },
              {
                label: "Avg Risk Score",
                value: (() => {
                  const scores = events.map(e => e.output_json?.riskScore).filter(s => s !== undefined);
                  return scores.length ? (scores.reduce((a: number, b: number) => a + b, 0) / scores.length).toFixed(1) : "—";
                })(),
              },
            ].map(stat => (
              <div key={stat.label} className="glass-panel p-4 text-center">
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Charts grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PriceHistoryChart events={events} />
            <div className="space-y-6">
              <DecisionChart       events={events} />
              <RiskScoreChart      events={events} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SentimentChart      events={events} />
            <RiskRadarChart      events={events} />
          </div>

          <ForecastAccuracyChart events={events} />
        </div>
      ) : (
        /* ── Events / Reasoning Chain View ── */
        <div className="space-y-4">
          {events.map(event => (
            <ReasoningChain key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
