export const PROMPT = `Ask a question to a specific external AI model for expert analysis.

This tool allows you to consult different AI models for their unique perspectives and expertise.

CRITICAL REQUIREMENT FOR QUESTION PARAMETER:
The question MUST be completely self-contained and include:
1. FULL BACKGROUND CONTEXT - All relevant information the expert needs
2. SPECIFIC SITUATION - Clear description of the current scenario/problem
3. INDEPENDENT QUESTION - What exactly you want the expert to analyze/answer

The expert model receives ONLY your question content with NO access to:
- Previous conversation history (unless using existing session)
- Current codebase or file context
- User's current task or project details

IMPORTANT: This tool is for asking questions to models, not for task execution.
- Use when you need a specific model's opinion or analysis
- Use when you want to compare different models' responses
- Use the @ask-[model] format when available

The expert_model parameter accepts:
- OpenAI: gpt-4, gpt-5, o1-preview
- Messages API: claude-3-5-sonnet, claude-3-opus
- Others: kimi, gemini-pro, mixtral

Example of well-structured question:
"Background: I'm working on a React TypeScript application with performance issues. The app renders a large list of 10,000 items using a simple map() function, causing UI freezing.

Current situation: Users report 3-5 second delays when scrolling through the list. The component re-renders the entire list on every state change.

Question: What are the most effective React optimization techniques for handling large lists, and how should I prioritize implementing virtualization vs memoization vs other approaches?"`
