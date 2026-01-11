"use client";

import * as React from "react";
import { Box, Typography, Paper, Button, Stack } from "@mui/material";
import ChatIcon from "@mui/icons-material/Chat";
import Link from "next/link";
import { useSocket } from "../providers";

export default function HomePage(): React.ReactElement {
  const { userId } = useSocket();

  return (
    <Box sx={{ maxWidth: 800, mx: "auto" }}>
      {/* Hero Section */}
      <Paper
        sx={{
          p: 4,
          textAlign: "center",
          mb: 4,
          background: "linear-gradient(135deg, rgba(124, 58, 237, 0.1) 0%, rgba(6, 182, 212, 0.1) 100%)",
        }}
      >
        <Typography variant="h3" component="h1" gutterBottom sx={{ fontWeight: 700 }}>
          Welcome to Quickdraw Chat
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ mb: 3 }}>
          Real-time chat application built with the Quickdraw framework
        </Typography>
        {userId ? (
          <Button
            component={Link}
            href="/chats"
            variant="contained"
            size="large"
            startIcon={<ChatIcon />}
          >
            Go to Chats
          </Button>
        ) : (
          <Button
            component={Link}
            href="/auth/login"
            variant="contained"
            size="large"
          >
            Sign In to Get Started
          </Button>
        )}
      </Paper>

      {/* Features Section */}
      <Typography variant="h5" gutterBottom sx={{ fontWeight: 600 }}>
        Features
      </Typography>
      <Stack spacing={2}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Real-time Messaging
          </Typography>
          <Typography color="text.secondary">
            Send and receive messages instantly with Socket.IO-powered real-time
            communication.
          </Typography>
        </Paper>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Multi-user Chats
          </Typography>
          <Typography color="text.secondary">
            Create chat rooms and invite multiple users to collaborate in
            real-time.
          </Typography>
        </Paper>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Access Control
          </Typography>
          <Typography color="text.secondary">
            Fine-grained permissions with Read, Moderate, and Admin access
            levels.
          </Typography>
        </Paper>
      </Stack>
    </Box>
  );
}
