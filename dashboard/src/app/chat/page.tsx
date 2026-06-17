import { ChatBox } from "@/components/ChatBox";

export default function ChatPage() {
  return (
    <div className="max-w-3xl mx-auto pt-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-outfit font-bold">Orchestrator <span className="gradient-text">Chat</span></h1>
        <p className="text-muted-foreground mt-2">
          Ask questions about agent activity, trading decisions, or governance consensus in plain English.
        </p>
      </div>
      <ChatBox />
    </div>
  );
}
