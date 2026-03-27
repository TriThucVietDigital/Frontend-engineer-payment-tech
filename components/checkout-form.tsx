"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, CheckCircle2, X, AlertCircle } from "lucide-react"
import { PI_APP_CONFIG, usePiAuth } from "@/contexts/pi-auth-context"
import { PaymentMethodSelector, type PaymentMethod } from "@/components/payment-method-selector"

interface CheckoutFormProps {
  totalPrice: number
  productName: string
  quantity: number
  productId: string
  storeId?: string
  onClose: () => void
}

export function CheckoutForm({ totalPrice, productName, quantity, productId, storeId, onClose }: CheckoutFormProps) {
  const { isAuthenticated, piAccessToken } = usePiAuth()
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>(null)

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    address: "",
  })
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [orderId, setOrderId] = useState("")
  const [transactionId, setTransactionId] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [errorAlert, setErrorAlert] = useState("")

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = "Vui lòng nhập họ tên"
    }
    if (!formData.phone.trim()) {
      newErrors.phone = "Vui lòng nhập số điện thoại"
    } else if (!/^[0-9]{10,11}$/.test(formData.phone.replace(/\s/g, ""))) {
      newErrors.phone = "Số điện thoại không hợp lệ"
    }
    if (!formData.address.trim()) {
      newErrors.address = "Vui lòng nhập địa chỉ giao hàng"
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    console.log("📋 Form submitted with data:", formData)

    if (!isAuthenticated || !piAccessToken) {
      const errorMsg = "⚠️ Bạn chưa xác thực với Pi Network. Vui lòng chờ xác thực hoàn tất hoặc refresh trang."
      console.error(errorMsg)
      setErrorAlert(errorMsg)
      alert(
        "❌ LỖI XÁC THỰC\n\nBạn chưa đăng nhập Pi Network!\n\nHãy chờ màn hình xác thực hoàn tất hoặc refresh lại trang.",
      )
      return
    }

    if (!validateForm()) {
      console.log("❌ Validation failed")
      return
    }

    console.log("✅ Customer Order Data:", {
      ...formData,
      product: productName,
      quantity,
      totalPrice,
      timestamp: new Date().toISOString(),
    })

    setIsProcessing(true)
    setErrorAlert("") // Clear previous errors

    try {
      if (typeof window.Pi === "undefined") {
        throw new Error("Pi SDK not available. Please ensure the app is running in Pi Browser.")
      }

      const generatedOrderId = `PI${Math.floor(10000 + Math.random() * 90000)}`
      
      // Platform fee: 0.00001 Pi (không hiển thị cho người dùng)
      const PLATFORM_FEE = 0.00001
      const totalWithFee = totalPrice + PLATFORM_FEE

      console.log("💰 Initiating Pi payment...")
      console.log("📱 App ID:", PI_APP_CONFIG.APP_ID)
      console.log("🔑 API Key:", PI_APP_CONFIG.API_KEY)
      console.log("🌐 Official Domain:", PI_APP_CONFIG.OFFICIAL_DOMAIN)
      console.log("💳 Wallet Address (Recipient):", PI_APP_CONFIG.WALLET_ADDRESS)
      console.log("💵 Product Amount:", totalPrice, "Pi")
      console.log("🏪 Platform Fee:", PLATFORM_FEE, "Pi (internal)")
      console.log("💰 Total Transaction:", totalWithFee, "Pi")
      console.log("📝 Order ID:", generatedOrderId)
      console.log("🔧 Sandbox Mode:", true, "(TESTNET)")
      console.log("🔐 User Access Token:", piAccessToken ? "✓ Present" : "✗ Missing")

      window.Pi.createPayment(
        {
          amount: totalWithFee,
          memo: `Thanh toán đơn hàng #${generatedOrderId}`,
          metadata: {
            orderId: generatedOrderId,
            productId,
            productName,
            quantity,
            customerName: formData.name,
            customerPhone: formData.phone,
            customerAddress: formData.address,
            appId: PI_APP_CONFIG.APP_ID,
            apiKey: PI_APP_CONFIG.API_KEY,
            recipientWalletAddress: PI_APP_CONFIG.WALLET_ADDRESS,
            officialDomain: PI_APP_CONFIG.OFFICIAL_DOMAIN,
            sandbox: true,
          },
        },
        {
          // BUOC 1: Pi SDK yeu cau server phe duyet truoc khi mo vi
          // NEU KHONG goi API nay va tra ve { approved: true } -> Pi KHONG chuyen tien
          onReadyForServerApproval: async (paymentId: string) => {
            console.log("⏳ [Server Approval] Dang gui yeu cau phe duyet payment_id:", paymentId)
            try {
              const res = await fetch(`/api/pi/payment?stage=approve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  payment_id: paymentId,
                  amount: totalWithFee,
                  memo: `Thanh toan don hang #${generatedOrderId}`,
                  order_id: generatedOrderId,
                  user_uid: "",
                  to_address: PI_APP_CONFIG.WALLET_ADDRESS,
                }),
              })
              const data = await res.json()
              if (data.approved) {
                console.log("✅ [Server Approval] Server da phe duyet. Pi se mo vi nguoi dung...")
                setOrderId(generatedOrderId)
              } else {
                console.error("❌ [Server Approval] Server tu choi:", data)
                setIsProcessing(false)
                setErrorAlert("Server không phê duyệt giao dịch. Vui lòng thử lại.")
              }
            } catch (approvalErr) {
              console.error("❌ [Server Approval] Loi goi API approve:", approvalErr)
              setIsProcessing(false)
              setErrorAlert("Không thể kết nối server để phê duyệt thanh toán.")
            }
          },

          // BUOC 2: Nguoi dung da ky tren blockchain → goi complete
          onReadyForServerCompletion: async (paymentId: string, txid: string) => {
            console.log("⏳ [Server Completion] Blockchain xac nhan. Dang luu giao dich...", { paymentId, txid })
            try {
              const res = await fetch(`/api/pi/payment?stage=complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  payment_id: paymentId,
                  txid,
                  amount: totalWithFee,
                  memo: `Thanh toan don hang #${generatedOrderId}`,
                  order_id: generatedOrderId,
                  user_uid: "",
                  to_address: PI_APP_CONFIG.WALLET_ADDRESS,
                }),
              })
              const data = await res.json()
              if (data.completed) {
                console.log("🎊 [Server Completion] Giao dich hoan tat! txid:", txid)
                setTransactionId(txid)
                setIsProcessing(false)
                setIsSuccess(true)
              } else {
                console.error("❌ [Server Completion] Server khong xac nhan:", data)
                setIsProcessing(false)
                setErrorAlert("Giao dịch blockchain thành công nhưng server chưa xác nhận. Liên hệ hỗ trợ.")
              }
            } catch (completeErr) {
              console.error("❌ [Server Completion] Loi goi API complete:", completeErr)
              // Blockchain da xac nhan → van bao thanh cong + luu txid
              setTransactionId(txid)
              setIsProcessing(false)
              setIsSuccess(true)
            }
          },

          onCancel: (paymentId: string) => {
            console.log("⚠️ Payment cancelled by user:", paymentId)
            setIsProcessing(false)
            const cancelMsg = "Thanh toán đã bị hủy bởi người dùng"
            setErrorAlert(cancelMsg)
          },
          onError: (error: Error, payment?: any) => {
            console.error("❌ Payment error:", error, payment)
            setIsProcessing(false)
            const errorMsg = error.message || "Unknown error"
            setErrorAlert(errorMsg)
          },
        },
      )
    } catch (error) {
      console.error("❌ Error initiating Pi payment:", error)
      setIsProcessing(false)
      const errMsg = error instanceof Error ? error.message : "Unknown error"
      setErrorAlert(errMsg)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))

    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }))
    }
  }

  const isFormComplete = formData.name.trim() && formData.phone.trim() && formData.address.trim()

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <Card className="w-full max-w-lg bg-background rounded-t-3xl sm:rounded-2xl shadow-2xl animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 duration-300">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b px-6 py-4 flex items-center justify-between z-10 rounded-t-3xl sm:rounded-t-2xl">
          <h2 className="text-xl font-bold">Thông tin giao hàng</h2>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {!isSuccess ? (
          <form onSubmit={handleSubmit} className="p-6 space-y-6 pb-8">
            {!isAuthenticated && (
              <Card className="p-4 bg-yellow-500/10 border-yellow-500/50">
                <div className="flex gap-3">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-yellow-900 dark:text-yellow-100">
                      Chưa xác thực Pi Network
                    </p>
                    <p className="text-xs text-yellow-800 dark:text-yellow-200">
                      Vui lòng chờ xác thực hoàn tất trước khi thanh toán
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {errorAlert && (
              <Card className="p-4 bg-red-500/10 border-red-500/50">
                <div className="flex gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-red-900 dark:text-red-100">Lỗi thanh toán</p>
                    <p className="text-xs text-red-800 dark:text-red-200">{errorAlert}</p>
                  </div>
                </div>
              </Card>
            )}

            <Card className="p-4 bg-muted">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">San pham:</span>
                  <span className="font-medium">{productName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">So luong:</span>
                  <span className="font-medium">{quantity}</span>
                </div>
                <div className="flex justify-between pt-2 border-t">
                  <span className="font-semibold">Tong tien:</span>
                  <span className="text-lg font-bold text-primary">π {totalPrice.toFixed(8).replace(/\.?0+$/, "")}</span>
                </div>
              </div>
            </Card>

            {/* Chon phuong thuc thanh toan */}
            <PaymentMethodSelector
              storeId={storeId}
              totalPriceVnd={Math.round(totalPrice * 314159 * 25800)}
              totalPricePi={totalPrice}
              selectedMethod={selectedPayment}
              onSelect={setSelectedPayment}
            />

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium">
                  Họ và tên <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Nhập họ tên của bạn"
                  disabled={isProcessing}
                  autoComplete="name"
                  className={errors.name ? "border-destructive" : ""}
                />
                {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm font-medium">
                  Số điện thoại <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="0912345678"
                  disabled={isProcessing}
                  autoComplete="tel"
                  className={errors.phone ? "border-destructive" : ""}
                />
                {errors.phone && <p className="text-sm text-destructive">{errors.phone}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="address" className="text-sm font-medium">
                  Địa chỉ giao hàng <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="address"
                  name="address"
                  type="text"
                  value={formData.address}
                  onChange={handleChange}
                  placeholder="Số nhà, đường, quận/huyện, tỉnh/thành phố"
                  disabled={isProcessing}
                  autoComplete="street-address"
                  className={errors.address ? "border-destructive" : ""}
                />
                {errors.address && <p className="text-sm text-destructive">{errors.address}</p>}
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full h-12 text-base font-semibold"
              disabled={isProcessing || !isFormComplete || !isAuthenticated || !selectedPayment}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Đang kết nối với ví Pi của bạn...
                </>
              ) : (
                <>Xác nhận thanh toán π {totalPrice.toFixed(8).replace(/\.?0+$/, '')}</>
              )}
            </Button>

            {!isFormComplete && (
              <p className="text-xs text-center text-muted-foreground">Vui lòng điền đầy đủ thông tin để tiếp tục</p>
            )}
            {!isAuthenticated && isFormComplete && (
              <p className="text-xs text-center text-yellow-600 dark:text-yellow-400">
                Đang chờ xác thực Pi Network...
              </p>
            )}
          </form>
        ) : (
          <div className="p-6 py-12 space-y-6 text-center">
            <div className="flex justify-center">
              <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center animate-bounce">
                <CheckCircle2 className="h-12 w-12 text-primary" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-primary">🎉 Chúc mừng!</h3>
              <p className="text-lg font-semibold">Đơn hàng đã được ghi nhận thành công!</p>
              <div className="pt-2 space-y-1">
                <p className="text-base font-semibold text-foreground">Mã đơn: {orderId}</p>
                {transactionId && (
                  <p className="text-sm text-muted-foreground">
                    Payment ID: <span className="font-mono text-xs">{transactionId}</span>
                  </p>
                )}
              </div>
              <p className="text-sm text-muted-foreground pt-2">Cảm ơn bạn đã mua hàng tại 314Mall 💚</p>
            </div>

            <Button size="lg" className="w-full" onClick={onClose}>
              Tiếp tục mua sắm
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
