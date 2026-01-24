import { createTheme, type ThemeOptions } from "@mui/material";

// Custom tokens accessible via theme.custom.*
declare module "@mui/material/styles" {
  interface Theme {
    custom: {
      iconSize: { sm: number; md: number; lg: number; xl: number };
    };
  }
  interface ThemeOptions {
    custom?: Theme["custom"];
  }
}

const baseOptions: ThemeOptions = {
  palette: {
    mode: "dark",
    primary: { main: "#7c3aed" },
    secondary: { main: "#06b6d4" },
    background: { default: "#0f172a", paper: "#1e293b" },
  },
  custom: {
    iconSize: { sm: 16, md: 24, lg: 48, xl: 64 },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    fontWeightMedium: 500,
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: "none" },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { borderRadius: 12 },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": { borderRadius: 8 },
        },
      },
    },
    MuiDialog: {
      defaultProps: {
        maxWidth: "sm",
        fullWidth: true,
      },
    },
    MuiIconButton: {
      defaultProps: {
        size: "small",
      },
    },
    MuiChip: {
      defaultProps: {
        size: "small",
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: { borderRadius: 8 },
      },
    },
  },
};

export const theme = createTheme(baseOptions);
