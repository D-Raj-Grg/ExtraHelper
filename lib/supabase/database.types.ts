export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_items: {
        Row: {
          bill_id: string
          description: string
          id: string
          order_item_id: string | null
          qty: number
          tax_cents: number
          tenant_id: string
          total_cents: number
          unit_price_cents: number
        }
        Insert: {
          bill_id: string
          description: string
          id?: string
          order_item_id?: string | null
          qty?: number
          tax_cents?: number
          tenant_id: string
          total_cents?: number
          unit_price_cents?: number
        }
        Update: {
          bill_id?: string
          description?: string
          id?: string
          order_item_id?: string | null
          qty?: number
          tax_cents?: number
          tenant_id?: string
          total_cents?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "bill_items_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          branch_id: string | null
          created_at: string
          discount_cents: number
          id: string
          service_charge_cents: number
          status: Database["public"]["Enums"]["bill_status"]
          subtotal_cents: number
          table_id: string | null
          tax_cents: number
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          discount_cents?: number
          id?: string
          service_charge_cents?: number
          status?: Database["public"]["Enums"]["bill_status"]
          subtotal_cents?: number
          table_id?: string | null
          tax_cents?: number
          tenant_id: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          discount_cents?: number
          id?: string
          service_charge_cents?: number
          status?: Database["public"]["Enums"]["bill_status"]
          subtotal_cents?: number
          table_id?: string | null
          tax_cents?: number
          tenant_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bills_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_default: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          branch_id: string | null
          cashier_id: string | null
          closed_at: string | null
          counted_cents: number | null
          expected_cents: number
          id: string
          opened_at: string
          opening_float_cents: number
          status: Database["public"]["Enums"]["cash_session_status"]
          tenant_id: string
          variance_cents: number | null
        }
        Insert: {
          branch_id?: string | null
          cashier_id?: string | null
          closed_at?: string | null
          counted_cents?: number | null
          expected_cents?: number
          id?: string
          opened_at?: string
          opening_float_cents?: number
          status?: Database["public"]["Enums"]["cash_session_status"]
          tenant_id: string
          variance_cents?: number | null
        }
        Update: {
          branch_id?: string | null
          cashier_id?: string | null
          closed_at?: string | null
          counted_cents?: number | null
          expected_cents?: number
          id?: string
          opened_at?: string
          opening_float_cents?: number
          status?: Database["public"]["Enums"]["cash_session_status"]
          tenant_id?: string
          variance_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      combos: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          items: Json
          name: string
          price_cents: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          items?: Json
          name: string
          price_cents?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          items?: Json
          name?: string
          price_cents?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "combos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          tenant_id: string
          type: Database["public"]["Enums"]["discount_type"]
          usage_limit: number | null
          used_count: number
          valid_from: string | null
          valid_to: string | null
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          tenant_id: string
          type: Database["public"]["Enums"]["discount_type"]
          usage_limit?: number | null
          used_count?: number
          valid_from?: string | null
          valid_to?: string | null
          value: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          tenant_id?: string
          type?: Database["public"]["Enums"]["discount_type"]
          usage_limit?: number | null
          used_count?: number
          valid_from?: string | null
          valid_to?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "coupons_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string | null
          id: string
          name: string | null
          phone: string | null
          tenant_id: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          tenant_id: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_tracking: {
        Row: {
          driver_name: string | null
          id: string
          lat: number | null
          lng: number | null
          online_order_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          driver_name?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          online_order_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          driver_name?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          online_order_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_tracking_online_order_id_fkey"
            columns: ["online_order_id"]
            isOneToOne: false
            referencedRelation: "online_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_tracking_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      discounts: {
        Row: {
          approved_by: string | null
          bill_id: string | null
          coupon_code: string | null
          created_at: string
          id: string
          order_item_id: string | null
          reason: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["discount_type"]
          value: number
        }
        Insert: {
          approved_by?: string | null
          bill_id?: string | null
          coupon_code?: string | null
          created_at?: string
          id?: string
          order_item_id?: string | null
          reason?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["discount_type"]
          value: number
        }
        Update: {
          approved_by?: string | null
          bill_id?: string | null
          coupon_code?: string | null
          created_at?: string
          id?: string
          order_item_id?: string | null
          reason?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["discount_type"]
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "discounts_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discounts_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          comment: string | null
          created_at: string
          customer_id: string | null
          id: string
          order_id: string | null
          rating: number | null
          tenant_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          order_id?: string | null
          rating?: number | null
          tenant_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          order_id?: string | null
          rating?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      floors: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          name: string
          sort: number
          tenant_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          name: string
          sort?: number
          tenant_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          name?: string
          sort?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "floors_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          branch_id: string | null
          category: string | null
          cost_cents: number
          created_at: string
          current_qty: number
          id: string
          name: string
          par_level: number
          reorder_level: number
          tenant_id: string
          uom: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          category?: string | null
          cost_cents?: number
          created_at?: string
          current_qty?: number
          id?: string
          name: string
          par_level?: number
          reorder_level?: number
          tenant_id: string
          uom?: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          category?: string | null
          cost_cents?: number
          created_at?: string
          current_qty?: number
          id?: string
          name?: string
          par_level?: number
          reorder_level?: number
          tenant_id?: string
          uom?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      item_modifiers: {
        Row: {
          id: string
          is_default: boolean
          item_id: string
          max_qty: number
          modifier_id: string
          tenant_id: string
        }
        Insert: {
          id?: string
          is_default?: boolean
          item_id: string
          max_qty?: number
          modifier_id: string
          tenant_id: string
        }
        Update: {
          id?: string
          is_default?: boolean
          item_id?: string
          max_qty?: number
          modifier_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_modifiers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_modifiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      item_station_routes: {
        Row: {
          id: string
          item_id: string
          station_id: string
          tenant_id: string
        }
        Insert: {
          id?: string
          item_id: string
          station_id: string
          tenant_id: string
        }
        Update: {
          id?: string
          item_id?: string
          station_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_station_routes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_station_routes_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "kitchen_stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_station_routes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      item_variants: {
        Row: {
          id: string
          item_id: string
          name: string
          price_delta_cents: number
          tenant_id: string
        }
        Insert: {
          id?: string
          item_id: string
          name: string
          price_delta_cents?: number
          tenant_id: string
        }
        Update: {
          id?: string
          item_id?: string
          name?: string
          price_delta_cents?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_variants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_variants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_stations: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_stations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_stations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kot_items: {
        Row: {
          id: string
          kot_id: string
          order_item_id: string | null
          qty: number
          status: Database["public"]["Enums"]["kot_status"]
          tenant_id: string
        }
        Insert: {
          id?: string
          kot_id: string
          order_item_id?: string | null
          qty?: number
          status?: Database["public"]["Enums"]["kot_status"]
          tenant_id: string
        }
        Update: {
          id?: string
          kot_id?: string
          order_item_id?: string | null
          qty?: number
          status?: Database["public"]["Enums"]["kot_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kot_items_kot_id_fkey"
            columns: ["kot_id"]
            isOneToOne: false
            referencedRelation: "kots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kot_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kot_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kots: {
        Row: {
          created_at: string
          id: string
          order_id: string
          printed_at: string | null
          station_id: string | null
          status: Database["public"]["Enums"]["kot_status"]
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          printed_at?: string | null
          station_id?: string | null
          status?: Database["public"]["Enums"]["kot_status"]
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          printed_at?: string | null
          station_id?: string | null
          status?: Database["public"]["Enums"]["kot_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kots_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "kitchen_stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_accounts: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          points_balance: number
          tenant_id: string
          tier: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          points_balance?: number
          tenant_id: string
          tier?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          points_balance?: number
          tenant_id?: string
          tier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_accounts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_transactions: {
        Row: {
          created_at: string
          id: string
          loyalty_account_id: string
          points: number
          reference: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["loyalty_txn_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          loyalty_account_id: string
          points?: number
          reference?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["loyalty_txn_type"]
        }
        Update: {
          created_at?: string
          id?: string
          loyalty_account_id?: string
          points?: number
          reference?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["loyalty_txn_type"]
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_loyalty_account_id_fkey"
            columns: ["loyalty_account_id"]
            isOneToOne: false
            referencedRelation: "loyalty_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_prices: {
        Row: {
          id: string
          item_id: string
          menu_id: string
          price_cents: number
          tenant_id: string
        }
        Insert: {
          id?: string
          item_id: string
          menu_id: string
          price_cents: number
          tenant_id: string
        }
        Update: {
          id?: string
          item_id?: string
          menu_id?: string
          price_cents?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_prices_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_prices_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_prices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          allergens: Json
          base_price_cents: number
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_86: boolean
          is_active: boolean
          name: string
          spice_level: number | null
          tax_class: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allergens?: Json
          base_price_cents?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_86?: boolean
          is_active?: boolean
          name: string
          spice_level?: number | null
          tax_class?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allergens?: Json
          base_price_cents?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_86?: boolean
          is_active?: boolean
          name?: string
          spice_level?: number | null
          tax_class?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_schedules: {
        Row: {
          day_of_week: number | null
          end_time: string
          id: string
          menu_id: string
          start_time: string
          tenant_id: string
        }
        Insert: {
          day_of_week?: number | null
          end_time: string
          id?: string
          menu_id: string
          start_time: string
          tenant_id: string
        }
        Update: {
          day_of_week?: number | null
          end_time?: string
          id?: string
          menu_id?: string
          start_time?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_schedules_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_schedules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menus: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          order_type: Database["public"]["Enums"]["order_type"] | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          order_type?: Database["public"]["Enums"]["order_type"] | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          order_type?: Database["public"]["Enums"]["order_type"] | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menus_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifiers: {
        Row: {
          id: string
          name: string
          price_cents: number
          tenant_id: string
        }
        Insert: {
          id?: string
          name: string
          price_cents?: number
          tenant_id: string
        }
        Update: {
          id?: string
          name?: string
          price_cents?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      online_orders: {
        Row: {
          address: Json | null
          branch_id: string | null
          channel: string
          created_at: string
          customer_id: string | null
          fee_cents: number
          fulfillment: Database["public"]["Enums"]["order_type"]
          id: string
          order_id: string | null
          slot_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: Json | null
          branch_id?: string | null
          channel?: string
          created_at?: string
          customer_id?: string | null
          fee_cents?: number
          fulfillment?: Database["public"]["Enums"]["order_type"]
          id?: string
          order_id?: string | null
          slot_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: Json | null
          branch_id?: string | null
          channel?: string
          created_at?: string
          customer_id?: string | null
          fee_cents?: number
          fulfillment?: Database["public"]["Enums"]["order_type"]
          id?: string
          order_id?: string | null
          slot_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_modifiers: {
        Row: {
          id: string
          modifier_id: string | null
          name_snapshot: string
          order_item_id: string
          price_cents: number
          qty: number
          tenant_id: string
        }
        Insert: {
          id?: string
          modifier_id?: string | null
          name_snapshot: string
          order_item_id: string
          price_cents?: number
          qty?: number
          tenant_id: string
        }
        Update: {
          id?: string
          modifier_id?: string | null
          name_snapshot?: string
          order_item_id?: string
          price_cents?: number
          qty?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_modifiers_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_modifiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          course: number | null
          created_at: string
          id: string
          is_void: boolean
          item_id: string | null
          name_snapshot: string
          notes: string | null
          order_id: string
          qty: number
          seat: number | null
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          unit_price_cents: number
          variant_id: string | null
          void_reason: string | null
        }
        Insert: {
          course?: number | null
          created_at?: string
          id?: string
          is_void?: boolean
          item_id?: string | null
          name_snapshot: string
          notes?: string | null
          order_id: string
          qty?: number
          seat?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          unit_price_cents?: number
          variant_id?: string | null
          void_reason?: string | null
        }
        Update: {
          course?: number | null
          created_at?: string
          id?: string
          is_void?: boolean
          item_id?: string | null
          name_snapshot?: string
          notes?: string | null
          order_id?: string
          qty?: number
          seat?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id?: string
          unit_price_cents?: number
          variant_id?: string | null
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "item_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          bill_id: string | null
          branch_id: string | null
          created_at: string
          customer_id: string | null
          id: string
          idempotency_key: string | null
          notes: string | null
          order_type: Database["public"]["Enums"]["order_type"]
          placed_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          table_id: string | null
          tenant_id: string
          updated_at: string
          waiter_id: string | null
        }
        Insert: {
          bill_id?: string | null
          branch_id?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          order_type?: Database["public"]["Enums"]["order_type"]
          placed_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_id?: string | null
          tenant_id: string
          updated_at?: string
          waiter_id?: string | null
        }
        Update: {
          bill_id?: string | null
          branch_id?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          order_type?: Database["public"]["Enums"]["order_type"]
          placed_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_id?: string | null
          tenant_id?: string
          updated_at?: string
          waiter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_orders_customer"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          bill_id: string
          created_at: string
          id: string
          idempotency_key: string | null
          method: Database["public"]["Enums"]["payment_method"]
          reference: string | null
          status: Database["public"]["Enums"]["payment_status"]
          tenant_id: string
        }
        Insert: {
          amount_cents?: number
          bill_id: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          method: Database["public"]["Enums"]["payment_method"]
          reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          bill_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          grp: string
          key: string
          label: string
          sort: number
        }
        Insert: {
          grp: string
          key: string
          label: string
          sort?: number
        }
        Update: {
          grp?: string
          key?: string
          label?: string
          sort?: number
        }
        Relationships: []
      }
      plans: {
        Row: {
          code: string
          created_at: string
          features: Json
          id: string
          interval: string
          is_active: boolean
          limits: Json
          name: string
          price_cents: number
        }
        Insert: {
          code: string
          created_at?: string
          features?: Json
          id?: string
          interval?: string
          is_active?: boolean
          limits?: Json
          name: string
          price_cents?: number
        }
        Update: {
          code?: string
          created_at?: string
          features?: Json
          id?: string
          interval?: string
          is_active?: boolean
          limits?: Json
          name?: string
          price_cents?: number
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_invoices: {
        Row: {
          amount_cents: number
          currency: string
          id: string
          issued_at: string
          paid_at: string | null
          status: string
          subscription_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents?: number
          currency?: string
          id?: string
          issued_at?: string
          paid_at?: string | null
          status?: string
          subscription_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          currency?: string
          id?: string
          issued_at?: string
          paid_at?: string | null
          status?: string
          subscription_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      po_items: {
        Row: {
          id: string
          inventory_item_id: string | null
          po_id: string
          qty_ordered: number
          qty_received: number
          tenant_id: string
          unit_cost_cents: number
        }
        Insert: {
          id?: string
          inventory_item_id?: string | null
          po_id: string
          qty_ordered?: number
          qty_received?: number
          tenant_id: string
          unit_cost_cents?: number
        }
        Update: {
          id?: string
          inventory_item_id?: string | null
          po_id?: string
          qty_ordered?: number
          qty_received?: number
          tenant_id?: string
          unit_cost_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "po_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          status: Database["public"]["Enums"]["po_status"]
          supplier_id: string | null
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          tenant_id: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          tenant_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          id: string
          inventory_item_id: string
          menu_item_id: string
          qty: number
          tenant_id: string
        }
        Insert: {
          id?: string
          inventory_item_id: string
          menu_item_id: string
          qty?: number
          tenant_id: string
        }
        Update: {
          id?: string
          inventory_item_id?: string
          menu_item_id?: string
          qty?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount_cents: number
          approved_by: string | null
          bill_id: string | null
          created_at: string
          id: string
          payment_id: string | null
          reason: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents?: number
          approved_by?: string | null
          bill_id?: string | null
          created_at?: string
          id?: string
          payment_id?: string | null
          reason?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          approved_by?: string | null
          bill_id?: string | null
          created_at?: string
          id?: string
          payment_id?: string | null
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          branch_id: string | null
          created_at: string
          customer_id: string | null
          deposit_cents: number
          id: string
          notes: string | null
          party_size: number
          reserved_at: string
          status: Database["public"]["Enums"]["reservation_status"]
          table_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          customer_id?: string | null
          deposit_cents?: number
          id?: string
          notes?: string | null
          party_size?: number
          reserved_at: string
          status?: Database["public"]["Enums"]["reservation_status"]
          table_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          customer_id?: string | null
          deposit_cents?: number
          id?: string
          notes?: string | null
          party_size?: number
          reserved_at?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          table_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_reservations_customer"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_tables: {
        Row: {
          branch_id: string | null
          capacity: number
          created_at: string
          current_order_id: string | null
          floor_id: string | null
          id: string
          label: string
          pos_x: number
          pos_y: number
          qr_token: string
          shape: string
          state: Database["public"]["Enums"]["table_state"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          capacity?: number
          created_at?: string
          current_order_id?: string | null
          floor_id?: string | null
          id?: string
          label: string
          pos_x?: number
          pos_y?: number
          qr_token?: string
          shape?: string
          state?: Database["public"]["Enums"]["table_state"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          capacity?: number
          created_at?: string
          current_order_id?: string | null
          floor_id?: string | null
          id?: string
          label?: string
          pos_x?: number
          pos_y?: number
          qr_token?: string
          shape?: string
          state?: Database["public"]["Enums"]["table_state"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_tables_current_order"
            columns: ["current_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_tables_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_tables_floor_id_fkey"
            columns: ["floor_id"]
            isOneToOne: false
            referencedRelation: "floors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_tables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_key: string
          role_id: string
        }
        Insert: {
          permission_key: string
          role_id: string
        }
        Update: {
          permission_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          base_role: Database["public"]["Enums"]["app_role"]
          color: string
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
          tenant_id: string
        }
        Insert: {
          base_role: Database["public"]["Enums"]["app_role"]
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          tenant_id: string
        }
        Update: {
          base_role?: Database["public"]["Enums"]["app_role"]
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_invites: {
        Row: {
          base_role: Database["public"]["Enums"]["app_role"]
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role_id: string | null
          tenant_id: string
        }
        Insert: {
          base_role: Database["public"]["Enums"]["app_role"]
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role_id?: string | null
          tenant_id: string
        }
        Update: {
          base_role?: Database["public"]["Enums"]["app_role"]
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_invites_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_shifts: {
        Row: {
          branch_id: string | null
          clock_in: string
          clock_out: string | null
          created_at: string
          id: string
          tenant_id: string
          tips_cents: number
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          clock_in?: string
          clock_out?: string | null
          created_at?: string
          id?: string
          tenant_id: string
          tips_cents?: number
          user_id: string
        }
        Update: {
          branch_id?: string | null
          clock_in?: string
          clock_out?: string | null
          created_at?: string
          id?: string
          tenant_id?: string
          tips_cents?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_items: {
        Row: {
          actual_qty: number
          id: string
          inventory_item_id: string | null
          stock_count_id: string
          tenant_id: string
          theoretical_qty: number
          variance: number | null
        }
        Insert: {
          actual_qty?: number
          id?: string
          inventory_item_id?: string | null
          stock_count_id: string
          tenant_id: string
          theoretical_qty?: number
          variance?: number | null
        }
        Update: {
          actual_qty?: number
          id?: string
          inventory_item_id?: string | null
          stock_count_id?: string
          tenant_id?: string
          theoretical_qty?: number
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_items_stock_count_id_fkey"
            columns: ["stock_count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_counts: {
        Row: {
          branch_id: string | null
          counted_by: string | null
          created_at: string
          id: string
          posted_at: string | null
          tenant_id: string
        }
        Insert: {
          branch_id?: string | null
          counted_by?: string | null
          created_at?: string
          id?: string
          posted_at?: string | null
          tenant_id: string
        }
        Update: {
          branch_id?: string | null
          counted_by?: string | null
          created_at?: string
          id?: string
          posted_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          inventory_item_id: string
          qty: number
          reference: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["stock_movement_type"]
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          inventory_item_id: string
          qty?: number
          reference?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["stock_movement_type"]
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          inventory_item_id?: string
          qty?: number
          reference?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["stock_movement_type"]
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          plan_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          tenant_id: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          tenant_id?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          tenant_id: string
        }
        Insert: {
          contact?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          tenant_id: string
        }
        Update: {
          contact?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      taxes: {
        Row: {
          id: string
          inclusive: boolean
          name: string
          rate: number
          tenant_id: string
        }
        Insert: {
          id?: string
          inclusive?: boolean
          name: string
          rate?: number
          tenant_id: string
        }
        Update: {
          id?: string
          inclusive?: boolean
          name?: string
          rate?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "taxes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          block_negative_stock: boolean
          currency: string
          order_type_fees: Json
          packaging_fee: number
          points_value_cents: number
          receipt_template: Json
          service_charge: number
          tax_rules: Json
          tenant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          block_negative_stock?: boolean
          currency?: string
          order_type_fees?: Json
          packaging_fee?: number
          points_value_cents?: number
          receipt_template?: Json
          service_charge?: number
          tax_rules?: Json
          tenant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          block_negative_stock?: boolean
          currency?: string
          order_type_fees?: Json
          packaging_fee?: number
          points_value_cents?: number
          receipt_template?: Json
          service_charge?: number
          tax_rules?: Json
          tenant_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          text_scale: number
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          text_scale?: number
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          text_scale?: number
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_tenants: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          role_id: string | null
          status: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          role_id?: string | null
          status?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          role_id?: string | null
          status?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tenants_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_tenants_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_tenants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wastage: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          inventory_item_id: string | null
          qty: number
          reason: string | null
          tenant_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          qty?: number
          reason?: string | null
          tenant_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          qty?: number
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wastage_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wastage_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wastage_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_member_by_email: {
        Args: { _email: string; _role_id: string; _tenant: string }
        Returns: string
      }
      adjust_inventory: {
        Args: {
          _delta: number
          _item: string
          _reason: string
          _type: Database["public"]["Enums"]["stock_movement_type"]
        }
        Returns: number
      }
      apply_bill_discount: {
        Args: {
          _bill_id: string
          _reason?: string
          _type: Database["public"]["Enums"]["discount_type"]
          _value: number
        }
        Returns: number
      }
      apply_coupon: {
        Args: { _bill_id: string; _code: string }
        Returns: number
      }
      apply_item_discount: {
        Args: {
          _order_item_id: string
          _reason?: string
          _type: Database["public"]["Enums"]["discount_type"]
          _value: number
        }
        Returns: undefined
      }
      apply_tenant_rls: { Args: { _table: unknown }; Returns: undefined }
      approve_member: {
        Args: { _tenant: string; _user_id: string }
        Returns: undefined
      }
      attach_bill_customer: {
        Args: { _bill_id: string; _name: string; _phone: string }
        Returns: string
      }
      bill_discount_total: {
        Args: { _bill_id: string; _subtotal: number }
        Returns: number
      }
      cancel_invite: {
        Args: { _email: string; _tenant: string }
        Returns: undefined
      }
      claim_invites: { Args: never; Returns: undefined }
      close_cash_session: {
        Args: { _counted_cents: number; _session_id: string }
        Returns: {
          counted_cents: number
          expected_cents: number
          variance_cents: number
        }[]
      }
      create_bill_for_order: { Args: { _order_id: string }; Returns: string }
      create_public_reservation: {
        Args: {
          _name: string
          _notes: string
          _party: number
          _phone: string
          _slug: string
          _when: string
        }
        Returns: string
      }
      current_tenant_ids: { Args: never; Returns: string[] }
      default_role_permissions: {
        Args: { _base: Database["public"]["Enums"]["app_role"] }
        Returns: string[]
      }
      fire_order: { Args: { _order_id: string }; Returns: number }
      get_my_permissions: { Args: { _tenant: string }; Returns: string[] }
      has_permission: {
        Args: { _key: string; _tenant: string }
        Returns: boolean
      }
      has_tenant_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _tenant: string
        }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      list_tenant_members: {
        Args: { _tenant: string }
        Returns: {
          base_role: Database["public"]["Enums"]["app_role"]
          created_at: string
          email: string
          role_id: string
          role_name: string
          status: string
          user_id: string
        }[]
      }
      loyalty_adjust: {
        Args: {
          _customer_id: string
          _points: number
          _reference?: string
          _type: Database["public"]["Enums"]["loyalty_txn_type"]
        }
        Returns: number
      }
      open_cash_session: {
        Args: {
          _branch_id: string
          _opening_float_cents: number
          _tenant: string
        }
        Returns: string
      }
      place_online_order: {
        Args: {
          _address: Json
          _fulfillment: string
          _items: Json
          _name: string
          _phone: string
          _slug: string
        }
        Returns: string
      }
      place_qr_order: {
        Args: { _items: Json; _token: string }
        Returns: string
      }
      place_staff_order: {
        Args: {
          _idempotency_key: string
          _items: Json
          _order_type: Database["public"]["Enums"]["order_type"]
          _table_id: string
          _tenant: string
        }
        Returns: string
      }
      post_stock_count: { Args: { _count_id: string }; Returns: number }
      provision_tenant: {
        Args: { _currency?: string; _name: string; _timezone?: string }
        Returns: string
      }
      qr_menu: { Args: { _token: string }; Returns: Json }
      qr_request_bill: { Args: { _token: string }; Returns: boolean }
      receive_po: { Args: { _po_id: string }; Returns: number }
      recompute_bill: { Args: { _bill_id: string }; Returns: undefined }
      record_payment: {
        Args: {
          _amount_cents: number
          _bill_id: string
          _idempotency_key?: string
          _method: Database["public"]["Enums"]["payment_method"]
        }
        Returns: Database["public"]["Enums"]["bill_status"]
      }
      redeem_points_for_bill: {
        Args: { _bill_id: string; _idempotency_key?: string; _points: number }
        Returns: Json
      }
      refund_payment: {
        Args: { _amount_cents: number; _bill_id: string; _reason: string }
        Returns: Database["public"]["Enums"]["bill_status"]
      }
      remove_member: {
        Args: { _tenant: string; _user_id: string }
        Returns: undefined
      }
      report_by_branch: {
        Args: { _from: string; _tenant: string; _to: string }
        Returns: {
          branch_id: string
          branch_name: string
          orders: number
          revenue_cents: number
        }[]
      }
      report_customers: {
        Args: { _from: string; _tenant: string; _to: string }
        Returns: {
          customer_id: string
          name: string
          orders: number
          points_redeemed: number
          spend_cents: number
        }[]
      }
      report_extras: {
        Args: { _from: string; _tenant: string; _to: string }
        Returns: {
          paid_orders: number
          refunds_cents: number
          tables_served: number
          voids: number
        }[]
      }
      report_inventory: {
        Args: { _from: string; _tenant: string; _to: string }
        Returns: {
          cogs_cents: number
          consumed: number
          cost_cents: number
          current_qty: number
          item_id: string
          name: string
          par_level: number
          reorder_level: number
          reorder_qty: number
          uom: string
          valuation_cents: number
          wasted: number
        }[]
      }
      report_payments: {
        Args: { _from: string; _tenant: string; _to: string }
        Returns: {
          amount_cents: number
          method: string
        }[]
      }
      report_sales: {
        Args: { _from: string; _tenant: string; _to: string }
        Returns: {
          discount_cents: number
          orders: number
          revenue_cents: number
          service_cents: number
          tax_cents: number
        }[]
      }
      report_sales_by_bill: {
        Args: {
          _dim: string
          _from: string
          _tenant: string
          _to: string
          _tz?: string
        }
        Returns: {
          label: string
          orders: number
          revenue_cents: number
        }[]
      }
      report_sales_by_category: {
        Args: { _from: string; _tenant: string; _to: string }
        Returns: {
          label: string
          orders: number
          revenue_cents: number
        }[]
      }
      report_staff: {
        Args: { _from: string; _tenant: string; _to: string }
        Returns: {
          email: string
          orders: number
          revenue_cents: number
          shift_minutes: number
          tips_cents: number
          user_id: string
        }[]
      }
      report_top_items: {
        Args: {
          _from: string
          _limit?: number
          _offset?: number
          _tenant: string
          _to: string
        }
        Returns: {
          description: string
          qty: number
          revenue_cents: number
        }[]
      }
      run_dunning: {
        Args: never
        Returns: {
          marked_past_due: number
          suspended: number
        }[]
      }
      seed_system_roles: { Args: { _tenant: string }; Returns: undefined }
      set_member_role: {
        Args: { _role_id: string; _tenant: string; _user_id: string }
        Returns: undefined
      }
      start_stock_count: { Args: { _tenant: string }; Returns: string }
      storefront_menu: { Args: { _slug: string }; Returns: Json }
      submit_feedback: {
        Args: { _comment: string; _rating: number; _token: string }
        Returns: boolean
      }
      subscribe_tenant: {
        Args: { _interval?: string; _plan_code: string; _tenant: string }
        Returns: string
      }
      tenant_has_feature: {
        Args: { _key: string; _tenant: string }
        Returns: boolean
      }
      trigger_dunning: {
        Args: never
        Returns: {
          marked_past_due: number
          suspended: number
        }[]
      }
      void_order_item: {
        Args: { _order_item_id: string; _reason: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "owner"
        | "manager"
        | "receptionist"
        | "cashier"
        | "waiter"
        | "kitchen"
        | "inventory"
      bill_status: "open" | "partial" | "paid" | "void"
      cash_session_status: "open" | "closed"
      discount_type: "percent" | "flat"
      kot_status: "new" | "preparing" | "ready" | "served" | "recalled"
      loyalty_txn_type: "earn" | "burn" | "adjust"
      order_status:
        | "draft"
        | "placed"
        | "in_kitchen"
        | "preparing"
        | "ready"
        | "served"
        | "billed"
        | "closed"
        | "cancelled"
      order_type: "dine_in" | "delivery" | "pickup" | "qr"
      payment_method: "cash" | "card" | "online" | "wallet" | "points"
      payment_status: "pending" | "completed" | "failed" | "refunded"
      po_status: "draft" | "sent" | "partial" | "received" | "cancelled"
      reservation_status:
        | "pending"
        | "confirmed"
        | "seated"
        | "cancelled"
        | "no_show"
      stock_movement_type:
        | "purchase"
        | "sale"
        | "wastage"
        | "staff_meal"
        | "transfer"
        | "adjustment"
        | "count"
      subscription_status: "trialing" | "active" | "past_due" | "cancelled"
      table_state:
        | "free"
        | "occupied"
        | "reserved"
        | "bill_requested"
        | "cleaning"
      tenant_status: "trial" | "active" | "suspended" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "owner",
        "manager",
        "receptionist",
        "cashier",
        "waiter",
        "kitchen",
        "inventory",
      ],
      bill_status: ["open", "partial", "paid", "void"],
      cash_session_status: ["open", "closed"],
      discount_type: ["percent", "flat"],
      kot_status: ["new", "preparing", "ready", "served", "recalled"],
      loyalty_txn_type: ["earn", "burn", "adjust"],
      order_status: [
        "draft",
        "placed",
        "in_kitchen",
        "preparing",
        "ready",
        "served",
        "billed",
        "closed",
        "cancelled",
      ],
      order_type: ["dine_in", "delivery", "pickup", "qr"],
      payment_method: ["cash", "card", "online", "wallet", "points"],
      payment_status: ["pending", "completed", "failed", "refunded"],
      po_status: ["draft", "sent", "partial", "received", "cancelled"],
      reservation_status: [
        "pending",
        "confirmed",
        "seated",
        "cancelled",
        "no_show",
      ],
      stock_movement_type: [
        "purchase",
        "sale",
        "wastage",
        "staff_meal",
        "transfer",
        "adjustment",
        "count",
      ],
      subscription_status: ["trialing", "active", "past_due", "cancelled"],
      table_state: [
        "free",
        "occupied",
        "reserved",
        "bill_requested",
        "cleaning",
      ],
      tenant_status: ["trial", "active", "suspended", "cancelled"],
    },
  },
} as const
