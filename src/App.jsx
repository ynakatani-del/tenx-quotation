import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import QuotationList from './pages/QuotationList'
import QuotationForm from './pages/QuotationForm'
import QuotationPrint from './pages/QuotationPrint'
import CustomerManagement from './pages/CustomerManagement'
import UserManagement from './pages/UserManagement'
import CompanyManagement from './pages/CompanyManagement'
import UnitPriceTable from './pages/UnitPriceTable'
import Aggregation from './pages/Aggregation'
import Settings from './pages/Settings'
import ProfileSettings from './pages/ProfileSettings'
import ApprovalResult from './pages/ApprovalResult'
import ApprovalAction from './pages/ApprovalAction'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/approval-result" element={<ApprovalResult />} />
      <Route path="/dashboard/approval-result" element={<ApprovalResult />} />
      <Route path="/approval-action" element={<ApprovalAction />} />
      <Route path="/dashboard/approval-action" element={<ApprovalAction />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route path="/dashboard" element={
        <ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>
      } />

      <Route path="/quotations" element={
        <ProtectedRoute><Layout><QuotationList /></Layout></ProtectedRoute>
      } />
      <Route path="/quotations/new" element={
        <ProtectedRoute><Layout><QuotationForm /></Layout></ProtectedRoute>
      } />
      <Route path="/quotations/:id/edit" element={
        <ProtectedRoute><Layout><QuotationForm /></Layout></ProtectedRoute>
      } />
      <Route path="/dashboard/quotations/:id/edit" element={
        <ProtectedRoute><Layout><QuotationForm /></Layout></ProtectedRoute>
      } />
      <Route path="/quotations/:id/print" element={
        <ProtectedRoute><Layout><QuotationPrint /></Layout></ProtectedRoute>
      } />

      <Route path="/customers" element={
        <ProtectedRoute requireAdmin><Layout><CustomerManagement /></Layout></ProtectedRoute>
      } />
      <Route path="/users" element={
        <ProtectedRoute requireSuperAdmin><Layout><UserManagement /></Layout></ProtectedRoute>
      } />
      <Route path="/companies" element={
        <ProtectedRoute requireAdmin><Layout><CompanyManagement /></Layout></ProtectedRoute>
      } />
      <Route path="/unit-prices" element={
        <ProtectedRoute><Layout><UnitPriceTable /></Layout></ProtectedRoute>
      } />
      <Route path="/aggregation" element={
        <ProtectedRoute><Layout><Aggregation /></Layout></ProtectedRoute>
      } />
      <Route path="/settings" element={
        <ProtectedRoute requireSuperAdmin><Layout><Settings /></Layout></ProtectedRoute>
      } />
      <Route path="/profile" element={
        <ProtectedRoute><Layout><ProfileSettings /></Layout></ProtectedRoute>
      } />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
