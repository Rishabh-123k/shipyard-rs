import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { ApiError } from "./api.ts";
import { AppShell } from "./components/AppShell.tsx";
import { Activity } from "./pages/Activity.tsx";
import { AddFunds } from "./pages/AddFunds.tsx";
import { Home } from "./pages/Home.tsx";
import { Journal } from "./pages/Journal.tsx";
import { Ask } from "./pages/Ask.tsx";
import { Markets } from "./pages/Markets.tsx";
import { ForgotPassword, ResetPassword } from "./pages/PasswordReset.tsx";
import { Shifts } from "./pages/Shifts.tsx";
import { Send } from "./pages/Send.tsx";
import { SignIn } from "./pages/SignIn.tsx";
import { SignUp } from "./pages/SignUp.tsx";
import { Trade } from "./pages/Trade.tsx";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failures, err) => !(err instanceof ApiError && err.status < 500) && failures < 2,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/signup" element={<SignUp />} />
          <Route path="/login" element={<SignIn />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<AppShell />}>
            <Route index element={<Markets />} />
            <Route path="/shifts" element={<Shifts />} />
            <Route path="/ask" element={<Ask />} />
            <Route path="/journal" element={<Journal />} />
            <Route path="/wallet" element={<Home />} />
            <Route path="/trade" element={<Trade />} />
            <Route path="/add-funds" element={<AddFunds />} />
            <Route path="/send" element={<Send />} />
            <Route path="/activity" element={<Activity />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
