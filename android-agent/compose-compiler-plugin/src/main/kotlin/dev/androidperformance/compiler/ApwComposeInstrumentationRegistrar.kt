@file:Suppress("DEPRECATION", "DEPRECATION_ERROR")

package dev.androidperformance.compiler

import org.jetbrains.kotlin.backend.common.extensions.IrGenerationExtension
import org.jetbrains.kotlin.backend.common.extensions.IrPluginContext
import org.jetbrains.kotlin.compiler.plugin.CompilerPluginRegistrar
import org.jetbrains.kotlin.compiler.plugin.ExperimentalCompilerApi
import org.jetbrains.kotlin.config.CompilerConfiguration
import org.jetbrains.kotlin.ir.IrStatement
import org.jetbrains.kotlin.ir.declarations.IrModuleFragment
import org.jetbrains.kotlin.ir.declarations.IrSimpleFunction
import org.jetbrains.kotlin.ir.expressions.IrBlockBody
import org.jetbrains.kotlin.ir.expressions.IrCall
import org.jetbrains.kotlin.ir.expressions.IrExpression
import org.jetbrains.kotlin.ir.IrElement
import org.jetbrains.kotlin.ir.expressions.IrWhen
import org.jetbrains.kotlin.ir.symbols.UnsafeDuringIrConstructionAPI
import org.jetbrains.kotlin.ir.util.fqNameWhenAvailable
import org.jetbrains.kotlin.ir.util.parentAsClass
import org.jetbrains.kotlin.ir.visitors.IrElementTransformerVoid
import org.jetbrains.kotlin.ir.visitors.transformChildrenVoid
import org.jetbrains.kotlin.name.CallableId
import org.jetbrains.kotlin.name.FqName
import org.jetbrains.kotlin.name.Name

@OptIn(ExperimentalCompilerApi::class)
class ApwComposeInstrumentationRegistrar : CompilerPluginRegistrar() {
    override val supportsK2: Boolean = true

    override fun ExtensionStorage.registerExtensions(configuration: CompilerConfiguration) {
        IrGenerationExtension.registerExtension(ApwComposeInstrumentationExtension())
    }
}

private class ApwComposeInstrumentationExtension : IrGenerationExtension {
    @OptIn(UnsafeDuringIrConstructionAPI::class)
    override fun generate(moduleFragment: IrModuleFragment, pluginContext: IrPluginContext) {
        val record = pluginContext.referenceFunctions(
            CallableId(FqName("dev.androidperformance.agent"), Name.identifier("apwComposeAutomaticExecution"))
        ).singleOrNull() ?: return
        val recordSkip = pluginContext.referenceFunctions(
            CallableId(FqName("dev.androidperformance.agent"), Name.identifier("apwComposeAutomaticSkip"))
        ).singleOrNull() ?: return
        val composable = FqName("androidx.compose.runtime.Composable")
        moduleFragment.transformChildrenVoid(object : IrElementTransformerVoid() {
            override fun visitSimpleFunction(declaration: IrSimpleFunction): IrStatement {
                val transformed = super.visitSimpleFunction(declaration)
                if (declaration.body == null || declaration.annotations.none {
                        it.symbol.owner.parentAsClass.fqNameWhenAvailable == composable
                    }) return transformed
                // Avoid recursively instrumenting the runtime helper if a target also marks it Composable.
                if (declaration.fqNameWhenAvailable?.asString()?.startsWith("dev.androidperformance.agent.") == true) return transformed
                val body = declaration.body as? IrBlockBody ?: return transformed
                val signature = (declaration.fqNameWhenAvailable?.asString() ?: declaration.name.asString()).take(300)
                val call = IrCalls.stringCall(
                    declaration.startOffset, declaration.endOffset,
                    pluginContext.irBuiltIns.unitType, pluginContext.irBuiltIns.stringType, record, signature
                )
                var skipGate: IrWhen? = null
                body.transform(object : IrElementTransformerVoid() {
                    override fun visitWhen(expression: IrWhen): IrExpression {
                        if (expression.branches.any { containsSkipCall(it.result) }) skipGate = expression
                        return super.visitWhen(expression)
                    }
                }, null)
                if (skipGate == null) {
                    body.statements.add(0, call)
                } else {
                    val skipBranches = skipGate!!.branches.filter { containsSkipCall(it.result) }
                    val normalBranches = skipGate!!.branches.filterNot { containsSkipCall(it.result) }
                    normalBranches.forEachIndexed { index, branch ->
                        val branchCall = if (index == normalBranches.lastIndex) call else IrCalls.stringCall(
                            declaration.startOffset, declaration.endOffset,
                            pluginContext.irBuiltIns.unitType, pluginContext.irBuiltIns.stringType, record, signature
                        )
                        IrCalls.prependToBranch(branch, branchCall)
                    }
                    skipBranches.forEach { branch ->
                        val skipCall = IrCalls.stringCall(
                            declaration.startOffset, declaration.endOffset,
                            pluginContext.irBuiltIns.unitType, pluginContext.irBuiltIns.stringType, recordSkip, signature
                        )
                        IrCalls.prependToBranch(branch, skipCall)
                    }
                }
                return transformed
            }
        })
    }

    @OptIn(UnsafeDuringIrConstructionAPI::class)
    private fun containsSkipCall(element: IrElement): Boolean {
        var found = false
        element.transform(object : IrElementTransformerVoid() {
            override fun visitCall(expression: IrCall): IrExpression {
                if (expression.symbol.owner.name.asString() == "skipToGroupEnd") found = true
                return super.visitCall(expression)
            }
        }, null)
        return found
    }
}
